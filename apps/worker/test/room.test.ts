import { env, evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hashState, type Action, type GameState, type PlayerView, type SeatId } from "@hb/engine";
import type { ClientMessage, ServerMessage } from "@hb/protocol";
import type { GameRoom } from "../src/room.ts";

type Message<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;

// One player's browser: a socket plus an inbox the test reads in order.
class Client {
  private inbox: ServerMessage[] = [];
  private wake: (() => void) | null = null;
  seq = 0;
  welcome: Message<"welcome"> | null = null;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      this.inbox.push(JSON.parse(event.data as string) as ServerMessage);
      this.wake?.();
    });
  }

  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }

  act(action: Action, seq = ++this.seq) {
    this.send({ t: "action", seq, action });
  }

  /** The first message of type `t` matching `where`, dropping anything before it. */
  async next<T extends ServerMessage["t"]>(t: T, where: (m: Message<T>) => boolean = () => true): Promise<Message<T>> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const index = this.inbox.findIndex((m) => m.t === t && where(m as Message<T>));
      if (index !== -1) return this.inbox.splice(0, index + 1).at(-1) as Message<T>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for "${t}"; inbox: ${JSON.stringify(this.inbox.map((m) => m.t))}`);
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, 50);
      });
    }
  }

  /** Every message received from now until the socket goes quiet. */
  async drain(): Promise<ServerMessage[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return this.inbox.splice(0);
  }
}

async function createRoom(hands: "open" | "hidden" = "open"): Promise<string> {
  const response = await SELF.fetch("https://room.test/api/rooms", { method: "POST", body: JSON.stringify({ hands }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}

async function connect(code: string, playerId: string): Promise<Client> {
  const response = await SELF.fetch(`https://room.test/api/rooms/${code}/ws`, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`no websocket (status ${response.status})`);
  ws.accept();
  const client = new Client(ws);
  client.send({ t: "hello", playerId, name: playerId });
  client.welcome = await client.next("welcome");
  return client;
}

async function startedGame(hands: "open" | "hidden" = "open") {
  const code = await createRoom(hands);
  const a = await connect(code, "player-a");
  const b = await connect(code, "player-b");
  a.send({ t: "takeSeat", seat: "seat-1", heroId: "test-hero-a" });
  await b.next("welcome", (m) => m.room.seats.length === 1);
  b.send({ t: "takeSeat", seat: "seat-2", heroId: "test-hero-b" });
  await a.next("welcome", (m) => m.room.seats.length === 2);
  a.send({ t: "startGame", year: 1 });
  const views = { "seat-1": (await a.next("view")).view, "seat-2": (await b.next("view")).view };
  return { code, clients: { "seat-1": a, "seat-2": b } as Record<SeatId, Client>, views: views as Record<SeatId, PlayerView>, version: 0 };
}

type Game = Awaited<ReturnType<typeof startedGame>>;

// A deliberately dumb player: answer any prompt with its first options,
// else play the first card in hand, else end the turn.
function nextMove(view: PlayerView): Action {
  if (view.pending) {
    return { type: "respondToInput", id: view.pending.id, choices: view.pending.options.slice(0, Math.max(1, view.pending.minChoices)).map((o) => o.id) };
  }
  const hand = view.players[view.turn.activeSeat]!.hand ?? [];
  return hand.length > 0 ? { type: "playCard", cardId: hand[0]! } : { type: "advancePhase" };
}

/** Plays one accepted action and waits until every client has its new view. */
async function step(game: Game): Promise<void> {
  const anyView = game.views["seat-1"]!;
  const seat = anyView.waitingOn ?? anyView.turn.activeSeat;
  const actor = game.clients[seat]!;
  actor.act(nextMove(game.views[seat]!));
  game.version++;
  for (const [s, client] of Object.entries(game.clients)) {
    game.views[s] = (await client.next("view", (m) => m.version === game.version)).view;
  }
}

const stub = (code: string) => env.GAME_ROOM.getByName(code);
const stateOf = (code: string) =>
  runInDurableObject(stub(code), (room: GameRoom) => structuredClone((room as unknown as { loaded: { state: GameState } }).loaded.state));

describe("rooms", () => {
  it("creates a room with a valid code and serves lobby metadata", async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const meta = (await (await SELF.fetch(`https://room.test/api/rooms/${code}`)).json()) as { started: boolean; seats: unknown[] };
    expect(meta).toMatchObject({ code, started: false, seats: [] });
    expect((await SELF.fetch("https://room.test/api/rooms/ZZZZZZ")).status).toBe(404);
  });

  it("gives both clients consistent views of the same game", async () => {
    const game = await startedGame();
    for (let i = 0; i < 5; i++) await step(game);
    const [one, two] = [game.views["seat-1"]!, game.views["seat-2"]!];
    expect(one.you).toBe("seat-1");
    expect(two.you).toBe("seat-2");
    // Everything but who's looking and their own prompt is shared.
    expect({ ...one, you: null, pending: null }).toEqual({ ...two, you: null, pending: null });
  });

  it("ignores a duplicate seq", async () => {
    const game = await startedGame();
    const actor = game.clients[game.views["seat-1"]!.turn.activeSeat]!;
    const move = nextMove(game.views[game.views["seat-1"]!.turn.activeSeat]!);
    actor.act(move, 1);
    await actor.next("view", (m) => m.version === 1);
    actor.act(move, 1); // a resend after a dropped socket
    const resync = await actor.next("view");
    expect(resync.version).toBe(1);
    expect((await stateOf(game.code)).log).toEqual(resync.log);
    const messages = await actor.drain();
    expect(messages.filter((m) => m.t === "view" && m.version > 1)).toEqual([]);
  });

  it("lets a client killed mid-turn reconnect, reclaim its seat, resync and carry on", async () => {
    const game = await startedGame();
    expect(game.views["seat-1"]!.turn.activeSeat).toBe("seat-1");
    await step(game); // seat 1 is part-way through its turn
    const lastSeq = game.clients["seat-1"]!.seq;
    game.clients["seat-1"]!.ws.close(1000, "tab killed");

    const back = await connect(game.code, "player-a");
    expect(back.welcome).toMatchObject({ you: "seat-1", lastSeq });
    const view = await back.next("view");
    expect(view.version).toBe(game.version);
    const expected = await stateOf(game.code);
    expect(view.view.players["seat-1"]!.hand).toEqual(expected.players["seat-1"]!.hand);

    // A fresh tab resumes from the room's seq, so its next action isn't
    // mistaken for a duplicate, and the turn continues where it left off.
    back.seq = back.welcome!.lastSeq;
    game.clients["seat-1"] = back;
    game.views["seat-1"] = view.view;
    await step(game);
  });

  it("rebuilds from snapshot and action log after the object is evicted between two actions", async () => {
    const game = await startedGame();
    // Past one snapshot (every 25 actions) so the rebuild uses snapshot + replay.
    while (game.version < 30 && game.views["seat-1"]!.status === "playing") await step(game);
    expect(game.version).toBeGreaterThan(25);
    const before = hashState(await stateOf(game.code));

    await evictDurableObject(stub(game.code));
    expect(hashState(await stateOf(game.code))).toBe(before);

    // Play continues on the rebuilt state.
    if (game.views["seat-1"]!.status === "playing") await step(game);
  });

  it("never sends deck order or the RNG seed to any seat or spectator", async () => {
    for (const hands of ["open", "hidden"] as const) {
      const game = await startedGame(hands);
      const spectator = await connect(game.code, "spectator");
      await spectator.next("view");

      for (let i = 0; i < 12 && game.views["seat-1"]!.status === "playing"; i++) {
        const state = await stateOf(game.code);
        const received = await Promise.all([game.clients["seat-1"]!.drain(), game.clients["seat-2"]!.drain(), spectator.drain()]);
        const messages = [...received.flat(), ...Object.values(game.views).map((view) => ({ t: "view", view }))];
        for (const message of messages) assertRedacted(message, state, hands);
        game.clients["seat-1"]!.send({ t: "resync" });
        game.clients["seat-2"]!.send({ t: "resync" });
        spectator.send({ t: "resync" });
        await step(game);
      }
    }
  });
});

const PRIVATE_KEYS = new Set(["rng", "seed", "cursor", "deck", "resolution", "modifiers", "counters", "resume"]);

function assertRedacted(message: unknown, state: GameState, hands: "open" | "hidden") {
  const json = JSON.stringify(message);
  // Whitelist check: no private field name appears anywhere in the message.
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        expect(PRIVATE_KEYS.has(key), `private key at ${path}.${key}`).toBe(false);
        walk(v, `${path}.${key}`);
      }
    }
  };
  walk(message, "$");
  expect(json).not.toContain(String(state.rng.seed));

  // No deck's order appears as a run of card ids. Short or single-card
  // decks could coincide with a hand or discard, so only long mixed ones.
  const decks = [state.market.deck, state.darkArts.deck, state.villains.deck, ...state.seats.map((s) => state.players[s]!.deck)];
  for (const deck of decks) {
    if (deck.length < 6 || new Set(deck).size < 2) continue;
    expect(json).not.toContain(JSON.stringify(deck).slice(1, -1));
  }

  // Hidden hands: a seat only ever sees its own.
  const view = (message as { view?: PlayerView }).view;
  if (view && hands === "hidden") {
    for (const seat of view.seats) if (seat !== view.you) expect(view.players[seat]!.hand).toBeNull();
  }
}

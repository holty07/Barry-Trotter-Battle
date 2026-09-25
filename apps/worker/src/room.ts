import { DurableObject } from "cloudflare:workers";
import { buildCardCatalog, buildSetupInput, parseContentSet, type ContentSet, type ScenarioYearId } from "@hb/content/browser";
import { reduce, setup, viewFor, type Action, type CardCatalog, type GameState, type HandVisibility, type SeatId } from "@hb/engine";
import { PING, PONG, SEATS, type ClientMessage, type RoomMeta, type ServerMessage } from "@hb/protocol";
import { contentFiles } from "./contentFiles.ts";

// docs/04-multiplayer.md. One GameRoom per room code: the only authoritative
// GameState, an append-only action log in SQLite, and redacted views fanned
// out over hibernatable sockets. The in-memory state is a disposable cache —
// hibernation or a restart drops it and `loaded` rebuilds from storage.

const SNAPSHOT_EVERY = 25;
const IDLE_MS = 30 * 24 * 60 * 60 * 1000;

type Attachment = { playerId: string; name: string };
type SeatRow = { seat: SeatId; player_id: string | null; name: string | null; hero_id: string; last_seq: number };
type Loaded = { state: GameState; version: number };

let parsed: { content: ContentSet; catalog: CardCatalog } | undefined;
function content() {
  if (!parsed) {
    const { content, issues } = parseContentSet(contentFiles);
    if (issues.length > 0) throw new Error(`bundled content has problems: ${issues.map((i) => `${i.file}: ${i.message}`).join("; ")}`);
    parsed = { content, catalog: buildCardCatalog(content) };
  }
  return parsed;
}

const send = (ws: WebSocket, message: ServerMessage) => ws.send(JSON.stringify(message));
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class GameRoom extends DurableObject<Env> {
  private cached: Loaded | null | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.createTables();
    // Keepalives answered by the runtime without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private createTables() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta      (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS actions   (n INTEGER PRIMARY KEY, seat TEXT, json TEXT);
      CREATE TABLE IF NOT EXISTS snapshots (n INTEGER PRIMARY KEY, json TEXT);
      CREATE TABLE IF NOT EXISTS seats     (seat TEXT PRIMARY KEY, player_id TEXT, name TEXT, hero_id TEXT, last_seq INTEGER NOT NULL DEFAULT 0);
    `);
  }

  private sql<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }

  private meta(k: string): string | null {
    return this.sql<{ v: string }>("SELECT v FROM meta WHERE k = ?", k)[0]?.v ?? null;
  }

  private setMeta(k: string, v: string) {
    this.sql("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
  }

  private touch() {
    void this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  // --- RPC from the Worker routes ---

  /** Claims this object for a new room. False if the code is already in use. */
  init(code: string, hands: HandVisibility): boolean {
    if (this.meta("code")) return false;
    this.setMeta("code", code);
    this.setMeta("hands", hands);
    this.touch();
    return true;
  }

  roomMeta(): RoomMeta | null {
    const code = this.meta("code");
    if (!code) return null;
    const year = this.meta("year");
    return {
      code,
      hands: this.hands(),
      year: year ? (Number(year) as ScenarioYearId) : null,
      started: this.loaded !== null,
      seats: this.sql<SeatRow>("SELECT * FROM seats ORDER BY seat").map((r) => ({ seat: r.seat, name: r.name, heroId: r.hero_id, taken: r.player_id !== null })),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.meta("code")) return new Response("no such room", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket upgrade", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- State: cache in memory, rebuild from storage ---

  private hands(): HandVisibility {
    return this.meta("hands") === "hidden" ? "hidden" : "open";
  }

  private get loaded(): Loaded | null {
    if (this.cached === undefined) this.cached = this.rebuild();
    return this.cached;
  }

  // Latest snapshot plus every later action replayed through the engine.
  // docs/04: this replay *is* the production determinism test, so a
  // divergence throws rather than being papered over.
  private rebuild(): Loaded | null {
    const snapshot = this.sql<{ n: number; json: string }>("SELECT n, json FROM snapshots ORDER BY n DESC LIMIT 1")[0];
    if (!snapshot) return null;
    const { catalog } = content();
    let state = JSON.parse(snapshot.json) as GameState;
    let version = snapshot.n;
    for (const row of this.sql<{ n: number; seat: string; json: string }>("SELECT n, seat, json FROM actions WHERE n > ? ORDER BY n", snapshot.n)) {
      const result = reduce(state, JSON.parse(row.json) as Action, { actingSeat: row.seat, catalog });
      if (!result.ok) throw new Error(`replay diverged at action ${row.n}: ${result.reason}`);
      state = result.state;
      version = row.n;
    }
    return { state, version };
  }

  // --- Sockets ---

  private seatOf(playerId: string): SeatRow | undefined {
    return this.sql<SeatRow>("SELECT * FROM seats WHERE player_id = ?", playerId)[0];
  }

  private welcome(playerId: string): ServerMessage {
    const row = this.seatOf(playerId);
    return { t: "welcome", you: row?.seat ?? null, lastSeq: row?.last_seq ?? 0, room: this.roomMeta()! };
  }

  private view(playerId: string): ServerMessage | null {
    const loaded = this.loaded;
    if (!loaded) return null;
    const view = viewFor(this.seatOf(playerId)?.seat ?? null, loaded.state, { hands: this.hands() });
    return { t: "view", version: loaded.version, view, log: loaded.state.log };
  }

  private sendState(ws: WebSocket, playerId: string, withWelcome: boolean) {
    if (withWelcome) send(ws, this.welcome(playerId));
    const view = this.view(playerId);
    if (view) send(ws, view);
  }

  private broadcast(withWelcome: boolean) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment) this.sendState(ws, attachment.playerId, withWelcome);
    }
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as ClientMessage;
      if (typeof msg !== "object" || msg === null || typeof msg.t !== "string") throw new Error();
    } catch {
      return send(ws, { t: "error", message: "unreadable message" });
    }

    if (msg.t === "hello") return this.hello(ws, msg);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return send(ws, { t: "error", message: "say hello first" });
    const { playerId, name } = attachment;

    switch (msg.t) {
      case "takeSeat":
        return this.takeSeat(ws, playerId, name || null, msg);
      case "releaseSeat":
        return this.releaseSeat(msg.seat);
      case "startGame":
        return this.startGame(ws, playerId, msg.year);
      case "action":
        return this.action(ws, playerId, msg);
      case "resync":
        return this.sendState(ws, playerId, true);
      default:
        return send(ws, { t: "error", message: `unknown message "${(msg as { t: string }).t}"` });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  private hello(ws: WebSocket, msg: Extract<ClientMessage, { t: "hello" }>) {
    if (typeof msg.playerId !== "string" || msg.playerId.length === 0 || msg.playerId.length > 100) {
      return send(ws, { t: "error", message: "hello needs a playerId" });
    }
    const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 40) : "";
    ws.serializeAttachment({ playerId: msg.playerId, name } satisfies Attachment);
    const row = this.seatOf(msg.playerId);
    if (row && name && row.name !== name) {
      this.sql("UPDATE seats SET name = ? WHERE seat = ?", name, row.seat);
      this.broadcast(true);
    } else {
      this.sendState(ws, msg.playerId, true);
    }
  }

  // Before the game: claim any free seat with a hero no one else has. After
  // it starts: only reclaim an in-game seat whose owner released it.
  private takeSeat(ws: WebSocket, playerId: string, name: string | null, msg: Extract<ClientMessage, { t: "takeSeat" }>) {
    if (!SEATS.includes(msg.seat)) return send(ws, { t: "error", message: "no such seat" });
    const row = this.sql<SeatRow>("SELECT * FROM seats WHERE seat = ?", msg.seat)[0];
    if (row?.player_id && row.player_id !== playerId) return send(ws, { t: "error", message: "That seat is taken." });
    const started = this.loaded !== null;

    if (started) {
      if (!row) return send(ws, { t: "error", message: "That seat isn't in this game." });
      this.ctx.storage.transactionSync(() => {
        this.sql("UPDATE seats SET player_id = NULL WHERE player_id = ?", playerId);
        this.sql("UPDATE seats SET player_id = ?, name = COALESCE(?, name) WHERE seat = ?", playerId, name, msg.seat);
      });
    } else {
      if (typeof msg.heroId !== "string" || msg.heroId.length === 0) return send(ws, { t: "error", message: "Choose a hero." });
      const clash = this.sql<SeatRow>("SELECT * FROM seats WHERE hero_id = ? AND seat != ?", msg.heroId, msg.seat)[0];
      if (clash) return send(ws, { t: "error", message: "Another player has that hero." });
      this.ctx.storage.transactionSync(() => {
        this.sql("DELETE FROM seats WHERE player_id = ?", playerId);
        this.sql("INSERT OR REPLACE INTO seats (seat, player_id, name, hero_id, last_seq) VALUES (?, ?, ?, ?, 0)", msg.seat, playerId, name, msg.heroId);
      });
    }
    this.touch();
    this.broadcast(true);
  }

  // docs/04 "Identity": anyone in the room can free a seat, for the player
  // who lost their localStorage. In-game seats keep their hero and seq.
  private releaseSeat(seat: SeatId) {
    if (this.loaded) this.sql("UPDATE seats SET player_id = NULL WHERE seat = ?", seat);
    else this.sql("DELETE FROM seats WHERE seat = ?", seat);
    this.touch();
    this.broadcast(true);
  }

  private startGame(ws: WebSocket, playerId: string, year: ScenarioYearId) {
    if (this.loaded) return send(ws, { t: "error", message: "The game has already started." });
    if (!this.seatOf(playerId)) return send(ws, { t: "error", message: "Take a seat first." });
    const seats = this.sql<SeatRow>("SELECT * FROM seats ORDER BY seat");
    if (seats.length < 2) return send(ws, { t: "error", message: "Two to four players are needed." });

    const { content: set, catalog } = content();
    if (!set.years.has(year)) return send(ws, { t: "error", message: `No card data for Year ${year}.` });
    let state: GameState;
    try {
      // Randomness lives here, never in the engine (CLAUDE.md hard rule 1).
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      const input = buildSetupInput(set, { year, seed, heroesBySeat: Object.fromEntries(seats.map((s) => [s.seat, s.hero_id])) });
      const initial = setup(input, catalog);
      const started = reduce(initial, { type: "advancePhase" }, { actingSeat: initial.turn.activeSeat, catalog });
      if (!started.ok) throw new Error(started.reason);
      state = started.state;
    } catch (err) {
      return send(ws, { t: "error", message: `Could not start the game: ${errorMessage(err)}` });
    }

    // Snapshot 0 is the started game, so a rebuild never re-runs setup.
    this.ctx.storage.transactionSync(() => {
      this.sql("INSERT INTO snapshots (n, json) VALUES (0, ?)", JSON.stringify(state));
      this.setMeta("year", String(year));
    });
    this.cached = { state, version: 0 };
    this.touch();
    this.broadcast(true);
  }

  // docs/01 "Data flow for a single move". Synchronous from read to
  // broadcast — no awaits inside a state transition.
  private action(ws: WebSocket, playerId: string, msg: Extract<ClientMessage, { t: "action" }>) {
    const row = this.seatOf(playerId);
    const loaded = this.loaded;
    if (!row || !loaded) return send(ws, { t: "error", message: row ? "The game hasn't started." : "Take a seat first." });
    if (!Number.isInteger(msg.seq)) return send(ws, { t: "error", message: "action needs an integer seq" });
    // A duplicate from a reconnect: already applied, so just resync.
    if (msg.seq <= row.last_seq) return this.sendState(ws, playerId, false);

    let result: ReturnType<typeof reduce>;
    try {
      result = reduce(loaded.state, msg.action, { actingSeat: row.seat, catalog: content().catalog });
    } catch (err) {
      result = { ok: false, reason: `engine error: ${errorMessage(err)}` };
    }
    if (!result.ok) return send(ws, { t: "rejected", seq: msg.seq, reason: result.reason });

    const n = loaded.version + 1;
    const state = result.state;
    this.ctx.storage.transactionSync(() => {
      this.sql("INSERT INTO actions (n, seat, json) VALUES (?, ?, ?)", n, row.seat, JSON.stringify(msg.action));
      this.sql("UPDATE seats SET last_seq = ? WHERE seat = ?", msg.seq, row.seat);
      if (n % SNAPSHOT_EVERY === 0) {
        this.sql("INSERT INTO snapshots (n, json) VALUES (?, ?)", n, JSON.stringify(state));
        this.sql("DELETE FROM snapshots WHERE n < ?", n);
      }
    });
    this.cached = { state, version: n };
    this.touch();
    this.broadcast(false);
  }

  // Re-armed on every state change, so firing means 30 days of quiet.
  override async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "room expired");
    await this.ctx.storage.deleteAll();
    this.cached = undefined;
    this.createTables();
  }
}

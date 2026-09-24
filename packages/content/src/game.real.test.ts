import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashState, reduce, setup, type Action, type CardCatalog, type GameState, type SeatId } from "@hb/engine";
import { buildCardCatalog, loadContent, resolveYear, startingDeckFor, type ContentSet } from "./index.ts";

// docs/06 M2c: "write a test that plays a complete Year 1 game against my
// content/ data ... assert a win. Write a second one that loses by control
// tokens." content/ is git-ignored (never committed, never present in CI),
// so this test skips itself rather than failing when it's missing — see
// docs/06 "content:check can run against fixtures in CI, since content/
// isn't committed."
const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../content");
const describeWithRealContent = existsSync(CONTENT_DIR) ? describe : describe.skip;

type LoggedAction = { seat: SeatId; action: Action };

/**
 * A deliberately simple (not strategically optimal) greedy player: play
 * every card in hand, buy the priciest affordable market card each turn
 * (preferring one that grants attack, but buying *something* regardless to
 * keep the market row cycling — a market slot only refills when its card is
 * bought), then throw all accumulated attack at the active villain. Any
 * `chooseOne`/`chooseTarget` prompt always takes the first option.
 *
 * Good enough to either win or lose a real Year 1 game depending on the
 * seed — which is all a golden replay needs: a real sequence of legal
 * actions against real content, not optimal play.
 */
function playFullGame(content: ContentSet, catalog: CardCatalog, seed: number): { state: GameState; log: LoggedAction[] } {
  const resolved = resolveYear(content, 1, 2);
  const seats: SeatId[] = ["seat-1", "seat-2"];
  const heroChoice: Record<SeatId, string> = { "seat-1": "harry-potter", "seat-2": "ron-weasley" };

  const heroesBySeat = Object.fromEntries(
    seats.map((seat) => [
      seat,
      { heroId: heroChoice[seat]!, heroLevel: resolved.heroLevel, startingDeck: startingDeckFor(content, heroChoice[seat]!) },
    ]),
  );

  let state = setup(
    {
      seed,
      year: 1,
      seats,
      heroesBySeat,
      villainSlotCount: resolved.villainSlots,
      marketRowSize: resolved.marketRowSize,
      startingHealth: resolved.startingHealth,
      market: resolved.market,
      villains: resolved.villains,
      darkArts: resolved.darkArts,
      locations: resolved.locations,
    },
    catalog,
  );

  const log: LoggedAction[] = [];

  function respondPending(): void {
    while (state.pending) {
      const seat = state.pending.seat;
      const action: Action = { type: "respondToInput", id: state.pending.id, choices: ["0"] };
      const result = reduce(state, action, { actingSeat: seat, catalog });
      if (!result.ok) throw new Error(`respondToInput failed: ${result.reason}`);
      log.push({ seat, action });
      state = result.state;
    }
  }

  function advance(): void {
    const seat = state.turn.activeSeat;
    const action: Action = { type: "advancePhase" };
    const result = reduce(state, action, { actingSeat: seat, catalog });
    if (!result.ok) throw new Error(`advancePhase failed: ${result.reason}`);
    log.push({ seat, action });
    state = result.state;
    respondPending();
  }

  function tryAction(seat: SeatId, action: Action): boolean {
    const result = reduce(state, action, { actingSeat: seat, catalog });
    if (!result.ok) return false;
    log.push({ seat, action });
    state = result.state;
    respondPending();
    return true;
  }

  function cardGrantsAttack(cardId: string): boolean {
    return JSON.stringify(catalog[cardId]?.effects ?? []).includes('"gainAttack"');
  }

  const MAX_TURNS = 200;
  let turns = 0;

  while (state.status === "playing" && turns < MAX_TURNS) {
    advance(); // turnStart -> darkArts
    advance(); // darkArts -> villainAbilities
    advance(); // villainAbilities -> main
    if (state.status !== "playing") break;

    const seat = state.turn.activeSeat;

    let playedSomething = true;
    while (playedSomething && state.status === "playing") {
      playedSomething = false;
      for (const cardId of [...state.players[seat]!.hand]) {
        if (tryAction(seat, { type: "playCard", cardId })) playedSomething = true;
        if (state.status !== "playing") break;
      }
    }

    let acquiredSomething = true;
    while (acquiredSomething && state.status === "playing") {
      const influence = state.players[seat]!.influence;
      const affordable = state.market.row.filter(
        (id): id is string => id !== null && catalog[id]?.cost !== undefined && catalog[id]!.cost! <= influence,
      );
      if (affordable.length === 0) break;
      affordable.sort((a, b) => {
        const attackDelta = Number(cardGrantsAttack(b)) - Number(cardGrantsAttack(a));
        return attackDelta !== 0 ? attackDelta : catalog[b]!.cost! - catalog[a]!.cost!;
      });
      acquiredSomething = tryAction(seat, { type: "acquireCard", cardId: affordable[0]! });
    }

    if (state.status === "playing") {
      const attack = state.players[seat]!.attack;
      const villainSlot = state.villains.slots.findIndex((s) => s !== null);
      if (villainSlot !== -1 && attack > 0) tryAction(seat, { type: "assignAttack", villainSlot, amount: attack });
    }
    if (state.status !== "playing") break;

    advance(); // main -> discardAndDraw
    advance(); // discardAndDraw -> turnEnd
    advance(); // turnEnd -> next seat's turnStart
    turns++;
  }

  return { state, log };
}

describeWithRealContent("a complete Year 1 game against real content/ data", () => {
  it("is winnable through reduce() calls (seed 1)", async () => {
    const content = await loadContent(CONTENT_DIR);
    const catalog = buildCardCatalog(content);
    const { state } = playFullGame(content, catalog, 1);
    expect(state.status).toBe("won");
    expect(state.villains.defeated).toHaveLength(3);
  });

  it("can be lost by villain control filling every location (seed 69)", async () => {
    const content = await loadContent(CONTENT_DIR);
    const catalog = buildCardCatalog(content);
    const { state } = playFullGame(content, catalog, 69);
    expect(state.status).toBe("lost");
    expect(state.locations.current).toBeGreaterThanOrEqual(state.locations.order.length);
  });

  it("golden replay: the recorded action log reproduces an identical state hash from a fresh setup", async () => {
    const content = await loadContent(CONTENT_DIR);
    const catalog = buildCardCatalog(content);
    const { state: played, log } = playFullGame(content, catalog, 1);

    const resolved = resolveYear(content, 1, 2);
    const heroChoice: Record<SeatId, string> = { "seat-1": "harry-potter", "seat-2": "ron-weasley" };
    let replayed = setup(
      {
        seed: 1,
        year: 1,
        seats: ["seat-1", "seat-2"],
        heroesBySeat: Object.fromEntries(
          Object.entries(heroChoice).map(([seat, heroId]) => [
            seat,
            { heroId, heroLevel: resolved.heroLevel, startingDeck: startingDeckFor(content, heroId) },
          ]),
        ),
        villainSlotCount: resolved.villainSlots,
        marketRowSize: resolved.marketRowSize,
        startingHealth: resolved.startingHealth,
        market: resolved.market,
        villains: resolved.villains,
        darkArts: resolved.darkArts,
        locations: resolved.locations,
      },
      catalog,
    );
    for (const { seat, action } of log) {
      const result = reduce(replayed, action, { actingSeat: seat, catalog });
      if (!result.ok) throw new Error(`replay diverged: ${result.reason}`);
      replayed = result.state;
    }

    expect(hashState(replayed)).toBe(hashState(played));
    expect(replayed).toEqual(played);
  });
});

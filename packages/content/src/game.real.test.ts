import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashState, reduce, setup, type Action, type CardCatalog, type GameState, type SeatId } from "@hb/engine";
import { buildCardCatalog, buildSetupInput, loadContent, type ContentSet } from "./index.ts";

// docs/06 M2c: "write a test that plays a complete Year 1 game against my
// content/ data ... assert a win. Write a second one that loses by control
// tokens." content/ is git-ignored (never committed, never present in CI),
// so this test skips itself rather than failing when it's missing — see
// docs/06 "content:check can run against fixtures in CI, since content/
// isn't committed."
const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../content");
const describeWithRealContent = existsSync(CONTENT_DIR) ? describe : describe.skip;

type LoggedAction = { seat: SeatId; action: Action };

// Two heroes picked by position from the loaded content (first and last
// level-1 hero, by id) so no real names live in the repo.
function heroesFor(content: ContentSet): Record<SeatId, string> {
  const ids = [...content.cards.values()].flatMap((c) => (c.type === "hero" && c.level === 1 ? [c.hero] : [])).sort();
  return { "seat-1": ids[0]!, "seat-2": ids[ids.length - 1]! };
}

function newGame(content: ContentSet, catalog: CardCatalog, seed: number): GameState {
  return setup(buildSetupInput(content, { year: 1, seed, heroesBySeat: heroesFor(content) }), catalog);
}

/**
 * A deliberately simple (not strategically optimal) greedy player: play
 * every card in hand, buy the priciest affordable market card each turn
 * (preferring one that grants attack, but buying *something* regardless to
 * keep the market row cycling — a market slot only refills when its card is
 * bought), then throw all accumulated attack at the active villain. Any
 * `chooseOne`/`chooseTarget` prompt always takes the first option. The
 * engine runs every non-main phase itself, so ending a turn is one action.
 */
function playFullGame(content: ContentSet, catalog: CardCatalog, seed: number): { state: GameState; log: LoggedAction[] } {
  let state = newGame(content, catalog, seed);
  const log: LoggedAction[] = [];

  function apply(seat: SeatId, action: Action): boolean {
    const result = reduce(state, action, { actingSeat: seat, catalog });
    if (!result.ok) return false;
    log.push({ seat, action });
    state = result.state;
    while (state.pending) {
      const pending = state.pending;
      const answer: Action = { type: "respondToInput", id: pending.id, choices: ["0"] };
      const answered = reduce(state, answer, { actingSeat: pending.seat, catalog });
      if (!answered.ok) throw new Error(`respondToInput failed: ${answered.reason}`);
      log.push({ seat: pending.seat, action: answer });
      state = answered.state;
    }
    return true;
  }

  const cardGrantsAttack = (cardId: string) => JSON.stringify(catalog[cardId]?.effects ?? []).includes('"gainAttack"');

  apply(state.turn.activeSeat, { type: "advancePhase" }); // start the game: runs to the first main phase

  for (let turns = 0; state.status === "playing" && turns < 200; turns++) {
    const seat = state.turn.activeSeat;

    let playedSomething = true;
    while (playedSomething && state.status === "playing") {
      playedSomething = false;
      for (const cardId of [...state.players[seat]!.hand]) {
        if (apply(seat, { type: "playCard", cardId })) playedSomething = true;
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
      acquiredSomething = apply(seat, { type: "acquireCard", cardId: affordable[0]! });
    }

    if (state.status === "playing") {
      const attack = state.players[seat]!.attack;
      const villainSlot = state.villains.slots.findIndex((s) => s !== null);
      if (villainSlot !== -1 && attack > 0) apply(seat, { type: "assignAttack", villainSlot, amount: attack });
    }
    if (state.status !== "playing") break;

    apply(seat, { type: "advancePhase" }); // end turn
  }

  return { state, log };
}

describeWithRealContent("a complete Year 1 game against real content/ data", () => {
  it("is winnable through reduce() calls (seed 1)", async () => {
    const content = await loadContent(CONTENT_DIR);
    const { state } = playFullGame(content, buildCardCatalog(content), 1);
    expect(state.status).toBe("won");
    expect(state.villains.defeated).toHaveLength(3);
  });

  it("can be lost by villain control filling every location (seed 69)", async () => {
    const content = await loadContent(CONTENT_DIR);
    const { state } = playFullGame(content, buildCardCatalog(content), 69);
    expect(state.status).toBe("lost");
    expect(state.locations.current).toBeGreaterThanOrEqual(state.locations.order.length);
  });

  it("golden replay: the recorded action log reproduces an identical state hash from a fresh setup", async () => {
    const content = await loadContent(CONTENT_DIR);
    const catalog = buildCardCatalog(content);
    const { state: played, log } = playFullGame(content, catalog, 1);

    let replayed = newGame(content, catalog, 1);
    for (const { seat, action } of log) {
      const result = reduce(replayed, action, { actingSeat: seat, catalog });
      if (!result.ok) throw new Error(`replay diverged: ${result.reason}`);
      replayed = result.state;
    }

    expect(hashState(replayed)).toBe(hashState(played));
    expect(replayed).toEqual(played);
  });
});

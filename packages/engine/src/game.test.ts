import { describe, expect, it } from "vitest";
import type { CardCatalog } from "./catalog.ts";
import { reduce, type ReduceContext } from "./reduce.ts";
import { setup, type SetupInput } from "./setup.ts";
import { hashState } from "./testing/hashState.ts";
import type { Action, GameState, SeatId } from "./types.ts";

// M2's "full Year 1 game" test, against a synthetic Year-1-shaped scenario
// rather than real content: only the metadata+text pass has been done on
// the real cards (docs/03's two-pass transcription workflow), so no real
// card has `effects` yet to actually play a game with. This proves the
// exact same engine surface — reduce(), setup(), win/loss, replay — and
// gets swapped for real content once the effects-authoring pass happens.

const HAND_SIZE = 5;

function scenario(overrides: Partial<SetupInput> = {}): SetupInput {
  return {
    seed: 42,
    year: 1,
    seats: ["seat-1", "seat-2"],
    heroesBySeat: {
      "seat-1": { heroId: "hero.a", heroLevel: 1, startingDeck: Array.from({ length: 10 }, () => "spell.zap") },
      "seat-2": { heroId: "hero.b", heroLevel: 1, startingDeck: Array.from({ length: 10 }, () => "spell.zap") },
    },
    villainSlotCount: 1,
    marketRowSize: 4,
    startingHealth: 10,
    market: Array.from({ length: 10 }, (_, i) => `market.filler-${i}`),
    villains: ["villain.only"],
    darkArts: Array.from({ length: 5 }, (_, i) => `darkarts.filler-${i}`),
    locations: ["location.only"],
    ...overrides,
  };
}

const winCatalog: CardCatalog = {
  "spell.zap": { effects: [{ op: "gainAttack", amount: 5 }] },
  "villain.only": { health: 3 },
  "location.only": { darkArtsPerTurn: 0, controlSlots: 1000 },
};

function advanceToMain(state: GameState, ctx: ReduceContext): GameState {
  for (let i = 0; i < 3; i++) {
    const result = reduce(state, { type: "advancePhase" }, ctx);
    if (!result.ok) throw new Error(`advanceToMain: ${result.reason}`);
    state = result.state;
  }
  return state;
}

describe("a complete Year-1-shaped game", () => {
  it("is playable start to a win through reduce() calls", () => {
    let state = setup(scenario(), winCatalog);
    const ctx: ReduceContext = { actingSeat: "seat-1", catalog: winCatalog };

    state = advanceToMain(state, ctx);
    const playResult = reduce(state, { type: "playCard", cardId: "spell.zap" }, ctx);
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;
    state = playResult.state;
    expect(state.players["seat-1"]!.attack).toBe(5);

    const attackResult = reduce(state, { type: "assignAttack", villainSlot: 0, amount: 3 }, ctx);
    expect(attackResult.ok).toBe(true);
    if (!attackResult.ok) return;
    state = attackResult.state;

    expect(state.status).toBe("won");
    expect(state.villains.defeated).toEqual(["villain.only"]);
  });

  it("is playable start to a loss by control tokens through reduce() calls", () => {
    const lossCatalog: CardCatalog = {
      "spell.zap": { effects: [{ op: "addControl", amount: 100 }] },
      "villain.only": { health: 3 },
      "location.only": { darkArtsPerTurn: 0, controlSlots: 5 },
    };
    let state = setup(scenario(), lossCatalog);
    const ctx: ReduceContext = { actingSeat: "seat-1", catalog: lossCatalog };

    state = advanceToMain(state, ctx);
    const result = reduce(state, { type: "playCard", cardId: "spell.zap" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.status).toBe("lost");
  });

  it("golden replay: the same seed and action log produce an identical state hash", () => {
    const run = (): { state: GameState; hash: string } => {
      let state = setup(scenario(), winCatalog);
      const bySeat = (seat: SeatId): ReduceContext => ({ actingSeat: seat, catalog: winCatalog });

      const log: { action: Action; seat: SeatId }[] = [
        { action: { type: "advancePhase" }, seat: "seat-1" },
        { action: { type: "advancePhase" }, seat: "seat-1" },
        { action: { type: "advancePhase" }, seat: "seat-1" },
        { action: { type: "playCard", cardId: "spell.zap" }, seat: "seat-1" },
        { action: { type: "assignAttack", villainSlot: 0, amount: 3 }, seat: "seat-1" },
      ];

      for (const { action, seat } of log) {
        const result = reduce(state, action, bySeat(seat));
        if (!result.ok) throw new Error(`replay diverged: ${result.reason}`);
        state = result.state;
      }
      return { state, hash: hashState(state) };
    };

    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.state).toEqual(b.state);
    expect(a.state.status).toBe("won");
  });

  it("golden replay: a different seed produces a different hash", () => {
    const runWithSeed = (seed: number): string => {
      let state = setup(scenario({ seed }), winCatalog);
      const ctx: ReduceContext = { actingSeat: "seat-1", catalog: winCatalog };
      state = advanceToMain(state, ctx);
      return hashState(state);
    };
    expect(runWithSeed(1)).not.toBe(runWithSeed(2));
  });

  it("hand starts at the deck-builder's standard 5 cards, sourced from the transcribed Turn Order card", () => {
    const state = setup(scenario(), winCatalog);
    expect(state.players["seat-1"]!.hand).toHaveLength(HAND_SIZE);
  });
});

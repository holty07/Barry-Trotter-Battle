import { describe, expect, it } from "vitest";
import type { GameState } from "./types.ts";

// docs/01 hard rule 4 / docs/02 invariant: GameState must be plain JSON —
// no class instances, Map/Set or functions — so a snapshot survives
// JSON.stringify/parse untouched. This is what crash recovery and replay
// files depend on.
function sampleState(): GameState {
  return {
    schema: 1,
    rng: { seed: 42, cursor: 3 },
    year: 1,
    status: "playing",
    phase: "main",
    turn: { activeSeat: "seat-1", number: 2 },
    seats: ["seat-1", "seat-2"],
    players: {
      "seat-1": {
        heroId: "hero.test-a",
        heroLevel: 1,
        deck: ["spell.a", "spell.b"],
        hand: ["item.a"],
        discard: [],
        inPlay: [],
        health: 10,
        maxHealth: 10,
        stunned: false,
        attack: 1,
        influence: 0,
        tokens: { focus: 2 },
      },
      "seat-2": {
        heroId: "hero.test-b",
        heroLevel: 1,
        deck: [],
        hand: [],
        discard: ["ally.a"],
        inPlay: ["item.b"],
        health: 8,
        maxHealth: 10,
        stunned: true,
        attack: 0,
        influence: 2,
        tokens: {},
      },
    },
    market: { deck: ["spell.c"], row: ["item.c", null], discard: [] },
    darkArts: { deck: ["darkarts.a"], discard: [], revealedThisTurn: [] },
    villains: { deck: ["villain.b"], slots: [{ cardId: "villain.a", damageTaken: 2 }], defeated: [] },
    locations: { order: ["location.a", "location.b"], current: 0, controlTokens: 1 },
    resolution: [],
    pending: null,
    modifiers: [],
    counters: { cardsPlayed: 1 },
    log: [{ turn: 1, kind: "turnStarted", seat: "seat-1" }],
  };
}

describe("GameState serialisation", () => {
  it("round-trips through JSON.stringify/parse unchanged", () => {
    const state = sampleState();
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState;
    expect(roundTripped).toEqual(state);
  });

  it("round-trips a state with a pending input and year-gated subsystems", () => {
    const state: GameState = {
      ...sampleState(),
      pending: {
        id: "prompt-1",
        seat: "seat-1",
        prompt: { key: "chooseDiscard" },
        minChoices: 1,
        maxChoices: 1,
        options: [{ id: "spell.a", label: "discardSpellA" }],
        resume: {
          kind: "chooseOne",
          ctx: { source: "spell.a", controller: "seat-1", vars: {} },
          chosenEffects: [{ op: "noop" }],
        },
      },
      horcruxes: { deck: ["horcrux.a"], active: null, destroyed: [] },
      proficiency: { "seat-1": "proficiency.a" },
    };
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

import { describe, expect, it } from "vitest";
import { setup } from "./setup.ts";
import type { GameState } from "./types.ts";
import { viewFor } from "./view.ts";

function baseState(): GameState {
  return setup(
    {
      seed: 12345,
      year: 1,
      seats: ["seat-1", "seat-2"],
      heroesBySeat: {
        "seat-1": { heroId: "hero.a", heroLevel: 1, startingDeck: Array.from({ length: 10 }, (_, i) => `spell.a-${i}`) },
        "seat-2": { heroId: "hero.b", heroLevel: 1, startingDeck: Array.from({ length: 10 }, (_, i) => `spell.b-${i}`) },
      },
      villainSlotCount: 1,
      marketRowSize: 2,
      startingHealth: 10,
      market: Array.from({ length: 6 }, (_, i) => `market.${i}`),
      villains: ["villain.a", "villain.b"],
      darkArts: Array.from({ length: 4 }, (_, i) => `darkarts.${i}`),
      locations: ["location.a"],
    },
    {},
  );
}

const withPending = (state: GameState): GameState => ({
  ...state,
  pending: {
    id: "p1",
    seat: "seat-2",
    prompt: { key: "chooseOne" },
    minChoices: 1,
    maxChoices: 1,
    options: [{ id: "0", label: "gainAttack" }],
    resume: { kind: "chooseOne", ctx: { source: "spell.secret-source", controller: "seat-2", vars: { hidden: "internal" } }, chosenEffects: [{ op: "noop" }] },
  },
});

describe("viewFor (docs/04 redaction)", () => {
  it("never leaks deck contents or the RNG to any seat, including spectators", () => {
    const state = withPending(baseState());
    const deckOnlyIds = [
      ...state.players["seat-1"]!.deck,
      ...state.players["seat-2"]!.deck,
      ...state.market.deck,
      ...state.darkArts.deck,
      ...state.villains.deck,
    ];
    expect(deckOnlyIds.length).toBeGreaterThan(0);
    for (const seat of ["seat-1", "seat-2", null]) {
      const json = JSON.stringify(viewFor(seat, state));
      for (const id of deckOnlyIds) expect(json).not.toContain(`"${id}"`);
      expect(json).not.toContain("rng");
      expect(json).not.toContain(String(state.rng.seed));
      expect(json).not.toContain("resume");
      expect(json).not.toContain("internal");
    }
  });

  it("reports deck sizes as counts", () => {
    const view = viewFor("seat-1", baseState());
    expect(view.players["seat-1"]!.deckCount).toBe(5);
    expect(view.market.deckCount).toBe(4);
    expect(view.villains.deckCount).toBe(1);
  });

  it("sends a pending prompt only to the seat that must answer; everyone sees who it's waiting on", () => {
    const state = withPending(baseState());
    const answering = viewFor("seat-2", state);
    expect(answering.pending).toEqual({
      id: "p1",
      seat: "seat-2",
      prompt: { key: "chooseOne" },
      minChoices: 1,
      maxChoices: 1,
      options: [{ id: "0", label: "gainAttack" }],
      source: "spell.secret-source",
    });
    expect(viewFor("seat-1", state).pending).toBeNull();
    expect(viewFor(null, state).pending).toBeNull();
    for (const seat of ["seat-1", "seat-2", null]) expect(viewFor(seat, state).waitingOn).toBe("seat-2");
  });

  it("hides other players' hands when the room says hidden, never your own", () => {
    const state = baseState();
    const view = viewFor("seat-1", state, { hands: "hidden" });
    expect(view.players["seat-1"]!.hand).toEqual(state.players["seat-1"]!.hand);
    expect(view.players["seat-2"]!.hand).toBeNull();
    expect(view.players["seat-2"]!.handCount).toBe(5);
    expect(viewFor("seat-1", state).players["seat-2"]!.hand).toEqual(state.players["seat-2"]!.hand);
  });

  it("doesn't share array references with the state", () => {
    const state = baseState();
    const view = viewFor("seat-1", state);
    view.players["seat-1"]!.hand!.pop();
    view.market.row.pop();
    expect(state.players["seat-1"]!.hand).toHaveLength(5);
    expect(state.market.row).toHaveLength(2);
  });
});

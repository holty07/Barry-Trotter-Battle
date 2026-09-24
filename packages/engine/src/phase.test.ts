import { describe, expect, it } from "vitest";
import type { CardCatalog } from "./catalog.ts";
import { setup } from "./setup.ts";
import { advancePhase } from "./phase.ts";
import type { GameState } from "./types.ts";

const emptyCatalog: CardCatalog = {};

function baseState(catalog: CardCatalog = emptyCatalog): GameState {
  return setup(
    {
      seed: 1,
      year: 1,
      seats: ["seat-1", "seat-2"],
      heroesBySeat: {
        "seat-1": { heroId: "hero.a", heroLevel: 1, startingDeck: Array.from({ length: 10 }, (_, i) => `spell.a-${i}`) },
        "seat-2": { heroId: "hero.b", heroLevel: 1, startingDeck: Array.from({ length: 10 }, (_, i) => `spell.b-${i}`) },
      },
      villainSlotCount: 1,
      marketRowSize: 6,
      startingHealth: 10,
      market: Array.from({ length: 20 }, (_, i) => `market.${i}`),
      villains: ["villain.a"],
      darkArts: Array.from({ length: 5 }, (_, i) => `darkarts.${i}`),
      locations: ["location.a"],
    },
    catalog,
  );
}

describe("advancePhase", () => {
  it("cycles through the full phase order for one seat", () => {
    let state = baseState();
    const seenPhases = [state.phase];
    for (let i = 0; i < 6; i++) {
      state = advancePhase(state, emptyCatalog);
      seenPhases.push(state.phase);
    }
    expect(seenPhases).toEqual([
      "turnStart",
      "darkArts",
      "villainAbilities",
      "main",
      "discardAndDraw",
      "turnEnd",
      "turnStart",
    ]);
  });

  it("advances to the next seat and increments the turn number on turnEnd -> turnStart", () => {
    let state = baseState();
    for (let i = 0; i < 6; i++) state = advancePhase(state, emptyCatalog);
    expect(state.turn).toEqual({ activeSeat: "seat-2", number: 2 });
  });

  it("wraps back to the first seat after the last seat's turn", () => {
    let state = baseState();
    for (let i = 0; i < 12; i++) state = advancePhase(state, emptyCatalog);
    expect(state.turn).toEqual({ activeSeat: "seat-1", number: 3 });
  });

  it("resets the finishing player's attack/influence and clears counters", () => {
    let state = baseState();
    state = {
      ...state,
      players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, attack: 3, influence: 2 } },
      counters: { cardsPlayed: 4 },
    };
    for (let i = 0; i < 6; i++) state = advancePhase(state, emptyCatalog);
    expect(state.players["seat-1"]!.attack).toBe(0);
    expect(state.players["seat-1"]!.influence).toBe(0);
    expect(state.counters).toEqual({});
  });

  it("heals a stunned player to full and clears stunned at the end of their own turn", () => {
    let state = baseState();
    state = {
      ...state,
      players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, stunned: true, health: 3 } },
    };
    for (let i = 0; i < 6; i++) state = advancePhase(state, emptyCatalog);
    expect(state.players["seat-1"]!.stunned).toBe(false);
    expect(state.players["seat-1"]!.health).toBe(state.players["seat-1"]!.maxHealth);
  });

  it("does not touch the incoming player's stunned status", () => {
    let state = baseState();
    state = { ...state, players: { ...state.players, "seat-2": { ...state.players["seat-2"]!, stunned: true } } };
    for (let i = 0; i < 6; i++) state = advancePhase(state, emptyCatalog);
    expect(state.turn.activeSeat).toBe("seat-2");
    expect(state.players["seat-2"]!.stunned).toBe(true);
  });

  it("does not mutate the input state", () => {
    const state = baseState();
    const snapshot = JSON.parse(JSON.stringify(state));
    advancePhase(state, emptyCatalog);
    expect(state).toEqual(snapshot);
  });

  it("reveals the active location's darkArtsPerTurn cards and queues their effects on entering darkArts", () => {
    const catalog: CardCatalog = {
      "location.a": { darkArtsPerTurn: 2 },
      "darkarts.0": { effects: [{ op: "gainAttack", amount: 1 }] },
      "darkarts.1": { effects: [{ op: "gainInfluence", amount: 1 }] },
    };
    let state = baseState(catalog);
    state = advancePhase(state, catalog); // turnStart -> darkArts
    expect(state.darkArts.revealedThisTurn).toHaveLength(2);
    expect(state.resolution).toHaveLength(2);
  });

  it("moves last turn's revealed Dark Arts to discard before revealing new ones", () => {
    const catalog: CardCatalog = { "location.a": { darkArtsPerTurn: 1 } };
    let state = baseState(catalog);
    state = { ...state, darkArts: { ...state.darkArts, revealedThisTurn: ["darkarts.leftover"] } };
    state = advancePhase(state, catalog);
    expect(state.darkArts.discard).toContain("darkarts.leftover");
    expect(state.darkArts.revealedThisTurn).not.toContain("darkarts.leftover");
  });

  it("emits villainAbilities on entering that phase, triggering a registered modifier", () => {
    const catalog: CardCatalog = {
      "villain.a": {
        health: 99,
        ability: [{ on: "villainAbilities", effect: { op: "gainAttack", amount: 1 }, duration: "permanent" }],
      },
    };
    let state = baseState(catalog);
    state = advancePhase(state, catalog); // turnStart -> darkArts
    state = advancePhase(state, catalog); // darkArts -> villainAbilities
    expect(state.resolution).toHaveLength(1);
    expect(state.resolution[0]!.effect).toEqual({ op: "gainAttack", amount: 1 });
  });

  it("discardAndDraw discards the active player's hand and draws a fresh 5", () => {
    let state = baseState();
    const seat = state.turn.activeSeat;
    const oldHand = state.players[seat]!.hand;
    for (let i = 0; i < 4; i++) state = advancePhase(state, emptyCatalog); // turnStart -> ... -> discardAndDraw
    expect(state.phase).toBe("discardAndDraw");
    expect(state.players[seat]!.hand).toHaveLength(5);
    expect(state.players[seat]!.discard).toEqual(expect.arrayContaining(oldHand));
    expect(state.players[seat]!.hand).not.toEqual(oldHand);
  });
});

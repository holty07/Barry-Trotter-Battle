import { describe, expect, it } from "vitest";
import { setup } from "./setup.ts";
import { reduce } from "./reduce.ts";
import type { GameState } from "./types.ts";

function baseState(): GameState {
  return setup({
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
  }, {});
}

const ctx = { actingSeat: "seat-1", catalog: {} };

function mainPhaseState(): GameState {
  let state = baseState();
  for (let i = 0; i < 3; i++) {
    const result = reduce(state, { type: "advancePhase" }, ctx);
    if (!result.ok) throw new Error("test setup: failed to advance to main phase");
    state = result.state;
  }
  return state;
}

describe("reduce", () => {
  it("advances the phase on advancePhase", () => {
    const result = reduce(baseState(), { type: "advancePhase" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.phase).toBe("darkArts");
  });

  it("rejects actions not yet implemented", () => {
    const result = reduce(baseState(), { type: "concede" }, ctx);
    expect(result).toEqual({ ok: false, reason: 'action "concede" is not implemented yet' });
  });

  it("rejects everything except respondToInput while an input is pending", () => {
    const state: GameState = {
      ...baseState(),
      pending: {
        id: "p1",
        seat: "seat-1",
        prompt: { key: "x" },
        minChoices: 1,
        maxChoices: 1,
        options: [],
        resume: { kind: "chooseOne", ctx: { source: "spell.a", controller: "seat-1", vars: {} }, chosenEffects: [] },
      },
    };
    const result = reduce(state, { type: "advancePhase" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("never mutates the input state", () => {
    const state = baseState();
    const snapshot = JSON.parse(JSON.stringify(state));
    reduce(state, { type: "advancePhase" }, ctx);
    expect(state).toEqual(snapshot);
  });

  it("resumes a chooseOne pending input and applies the chosen effect", () => {
    const state: GameState = {
      ...baseState(),
      pending: {
        id: "p1",
        seat: "seat-1",
        prompt: { key: "chooseOne" },
        minChoices: 1,
        maxChoices: 1,
        options: [{ id: "0", label: "a" }, { id: "1", label: "b" }],
        resume: {
          kind: "chooseOne",
          ctx: { source: "spell.a", controller: "seat-1", vars: {} },
          chosenEffects: [{ op: "gainAttack", amount: 3 }, { op: "gainInfluence", amount: 5 }],
        },
      },
    };
    const result = reduce(state, { type: "respondToInput", id: "p1", choices: ["1"] }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.pending).toBeNull();
      expect(result.state.players["seat-1"]!.influence).toBe(5);
      expect(result.state.players["seat-1"]!.attack).toBe(0);
    }
  });

  it("rejects respondToInput from the wrong seat", () => {
    const state: GameState = {
      ...baseState(),
      pending: {
        id: "p1",
        seat: "seat-2",
        prompt: { key: "chooseOne" },
        minChoices: 1,
        maxChoices: 1,
        options: [{ id: "0", label: "a" }],
        resume: { kind: "chooseOne", ctx: { source: "spell.a", controller: "seat-2", vars: {} }, chosenEffects: [{ op: "noop" }] },
      },
    };
    const result = reduce(state, { type: "respondToInput", id: "p1", choices: ["0"] }, ctx);
    expect(result).toEqual({ ok: false, reason: "wrong seat for this input" });
  });

  it("rejects a mismatched pending id", () => {
    const state: GameState = {
      ...baseState(),
      pending: {
        id: "p1",
        seat: "seat-1",
        prompt: { key: "chooseOne" },
        minChoices: 1,
        maxChoices: 1,
        options: [{ id: "0", label: "a" }],
        resume: { kind: "chooseOne", ctx: { source: "spell.a", controller: "seat-1", vars: {} }, chosenEffects: [{ op: "noop" }] },
      },
    };
    const result = reduce(state, { type: "respondToInput", id: "wrong-id", choices: ["0"] }, ctx);
    expect(result).toEqual({ ok: false, reason: "pending input id mismatch" });
  });
});

describe("reduce: playCard / acquireCard / assignAttack", () => {
  it("playCard is rejected outside the main phase", () => {
    const result = reduce(baseState(), { type: "playCard", cardId: "spell.a-0" }, ctx);
    expect(result).toEqual({ ok: false, reason: "that action is only allowed during the main phase" });
  });

  it("playCard is rejected when it isn't your turn", () => {
    const result = reduce(mainPhaseState(), { type: "playCard", cardId: "spell.a-0" }, { ...ctx, actingSeat: "seat-2" });
    expect(result).toEqual({ ok: false, reason: "not your turn" });
  });

  it("playCard is rejected when the card isn't in hand", () => {
    const result = reduce(mainPhaseState(), { type: "playCard", cardId: "not-in-hand" }, ctx);
    expect(result).toEqual({ ok: false, reason: "card is not in hand" });
  });

  it("playCard moves the card to inPlay and resolves its catalog effects", () => {
    const state = mainPhaseState();
    const cardId = state.players["seat-1"]!.hand[0]!;
    const catalog = { [cardId]: { effects: [{ op: "gainAttack" as const, amount: 2 }] } };
    const result = reduce(state, { type: "playCard", cardId }, { ...ctx, catalog });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players["seat-1"]!.inPlay).toContain(cardId);
    expect(result.state.players["seat-1"]!.hand).not.toContain(cardId);
    expect(result.state.players["seat-1"]!.attack).toBe(2);
  });

  it("playCard removes only one copy of a duplicated card id from hand", () => {
    let state = mainPhaseState();
    // seat-1's starting deck is 10x "spell.a-0" — all 5 opening-hand cards
    // share the same id.
    state = {
      ...state,
      players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, hand: ["spell.a-0", "spell.a-0", "spell.a-0"] } },
    };
    const result = reduce(state, { type: "playCard", cardId: "spell.a-0" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players["seat-1"]!.hand).toEqual(["spell.a-0", "spell.a-0"]);
    expect(result.state.players["seat-1"]!.inPlay).toEqual(["spell.a-0"]);
  });

  it("playCard increments a played:<type> counter from the catalog (Bertie Botts pattern)", () => {
    const state = mainPhaseState();
    const cardId = state.players["seat-1"]!.hand[0]!;
    const catalog = { [cardId]: { type: "ally" } };
    const result = reduce(state, { type: "playCard", cardId }, { ...ctx, catalog });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.counters["played:ally"]).toBe(1);
  });

  it("playCard doesn't touch played:<type> counters for a card with no catalog type", () => {
    const state = mainPhaseState();
    const cardId = state.players["seat-1"]!.hand[0]!;
    const result = reduce(state, { type: "playCard", cardId }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.state.counters)).toEqual([]);
  });

  it("playCard emits cardPlayed, triggering a registered modifier", () => {
    let state = mainPhaseState();
    const cardId = state.players["seat-1"]!.hand[0]!;
    state = {
      ...state,
      modifiers: [
        {
          id: "hero-ability",
          source: { kind: "card", id: "hero.a" },
          controller: "seat-1",
          on: "cardPlayed",
          effect: { op: "gainInfluence", amount: 1 },
          duration: "permanent",
        },
      ],
    };
    const result = reduce(state, { type: "playCard", cardId }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.players["seat-1"]!.influence).toBe(1);
  });

  it("acquireCard is rejected without enough influence", () => {
    const state = mainPhaseState();
    const cardId = state.market.row[0]!;
    const result = reduce(state, { type: "acquireCard", cardId }, { ...ctx, catalog: { [cardId]: { cost: 99 } } });
    expect(result).toEqual({ ok: false, reason: "not enough influence" });
  });

  it("acquireCard moves the card to discard, deducts cost, and refills the row", () => {
    let state = mainPhaseState();
    const cardId = state.market.row[0]!;
    state = { ...state, players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, influence: 5 } } };
    const deckBefore = state.market.deck.length;
    const result = reduce(state, { type: "acquireCard", cardId }, { ...ctx, catalog: { [cardId]: { cost: 3 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players["seat-1"]!.discard).toContain(cardId);
    expect(result.state.players["seat-1"]!.influence).toBe(2);
    expect(result.state.market.row).not.toContain(cardId);
    expect(result.state.market.row[0]).not.toBeNull();
    expect(result.state.market.deck).toHaveLength(deckBefore - 1);
  });

  it("assignAttack is rejected with insufficient attack", () => {
    const result = reduce(mainPhaseState(), { type: "assignAttack", villainSlot: 0, amount: 5 }, ctx);
    expect(result).toEqual({ ok: false, reason: "not enough attack" });
  });

  it("assignAttack deducts attack and damages the targeted villain slot", () => {
    let state = mainPhaseState();
    state = { ...state, players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, attack: 4 } } };
    const villainId = state.villains.slots[0]!.cardId;
    const result = reduce(state, { type: "assignAttack", villainSlot: 0, amount: 4 }, { ...ctx, catalog: { [villainId]: { health: 10 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players["seat-1"]!.attack).toBe(0);
    expect(result.state.villains.slots[0]!.damageTaken).toBe(4);
  });
});

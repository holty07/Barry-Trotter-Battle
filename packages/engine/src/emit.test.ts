import { describe, expect, it } from "vitest";
import { emit } from "./emit.ts";
import { setup } from "./setup.ts";
import type { GameState, Modifier } from "./types.ts";

function baseState(modifiers: Modifier[]): GameState {
  const state = setup(
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
    {},
  );
  return { ...state, modifiers };
}

function mod(id: string, over: Partial<Modifier>): Modifier {
  return {
    id,
    source: { kind: "card", id: "test.card" },
    on: "cardPlayed",
    effect: { op: "gainAttack", amount: 1 },
    duration: "thisTurn",
    ...over,
  };
}

describe("emit", () => {
  it("only pushes frames for modifiers matching the event type", () => {
    const state = baseState([mod("a", { on: "cardPlayed" }), mod("b", { on: "villainDefeated" })]);
    const result = emit(state, { type: "cardPlayed" });
    expect(result.resolution).toHaveLength(1);
  });

  it("skips a modifier whose condition doesn't hold", () => {
    const state = baseState([mod("a", { condition: { kind: "countAtLeast", ref: { matching: { zone: { owner: "market", zone: "deck" } } }, amount: 999_999 } })]);
    const result = emit(state, { type: "cardPlayed" });
    expect(result.resolution).toEqual([]);
  });

  it("orders triggers: active villain, location, active player's cards, other players' cards, permanents", () => {
    const state = baseState([
      mod("permanent", { source: { kind: "horcrux", id: "horcrux.x" } }),
      mod("otherPlayer", { source: { kind: "card", id: "card.other" }, controller: "seat-2" }),
      mod("activePlayer", { source: { kind: "card", id: "card.mine" }, controller: "seat-1" }),
      mod("location", { source: { kind: "location", id: "location.a" } }),
      mod("villain", { source: { kind: "villain", id: "villain.a" } }),
    ]);
    const result = emit(state, { type: "cardPlayed" });
    const order = result.resolution.map((frame) => frame.ctx.source);
    expect(order).toEqual(["villain.a", "location.a", "card.mine", "card.other", "horcrux.x"]);
  });

  it("preserves state.modifiers insertion order within the same bucket", () => {
    const state = baseState([
      mod("v1", { source: { kind: "villain", id: "villain.1" } }),
      mod("v2", { source: { kind: "villain", id: "villain.2" } }),
    ]);
    const result = emit(state, { type: "cardPlayed" });
    expect(result.resolution.map((f) => f.ctx.source)).toEqual(["villain.1", "villain.2"]);
  });

  it("does not drain — it only pushes frames onto resolution", () => {
    const state = baseState([mod("a", {})]);
    const result = emit(state, { type: "cardPlayed" });
    expect(result.players["seat-1"]!.attack).toBe(0);
    expect(result.resolution).toHaveLength(1);
  });
});

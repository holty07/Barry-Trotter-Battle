import { describe, expect, it } from "vitest";
import type { CardCatalog } from "./catalog.ts";
import { reduce } from "./reduce.ts";
import { setup } from "./setup.ts";
import type { GameState } from "./types.ts";

const catalog: CardCatalog = {
  "spell.zap": { type: "spell", effects: [{ op: "gainAttack", amount: 3 }] },
  "darkarts.push": { effects: [{ op: "addControl", amount: 1 }] },
  "villain.a": { health: 3 },
  "location.a": { darkArtsPerTurn: 1, controlSlots: 99 },
};

function started(): GameState {
  const state = setup(
    {
      seed: 1,
      year: 1,
      seats: ["seat-1", "seat-2"],
      heroesBySeat: {
        "seat-1": { heroId: "hero.a", heroLevel: 1, startingDeck: Array.from({ length: 10 }, () => "spell.zap") },
        "seat-2": { heroId: "hero.b", heroLevel: 1, startingDeck: Array.from({ length: 10 }, () => "spell.zap") },
      },
      villainSlotCount: 1,
      marketRowSize: 1,
      startingHealth: 10,
      market: ["market.a"],
      villains: ["villain.a"],
      darkArts: Array.from({ length: 6 }, () => "darkarts.push"),
      locations: ["location.a"],
    },
    catalog,
  );
  const result = reduce(state, { type: "advancePhase" }, { actingSeat: "seat-1", catalog });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const ctx = (seat: string) => ({ actingSeat: seat, catalog });

describe("game log", () => {
  it("records the first turn starting, its Dark Arts reveal and the control gain", () => {
    expect(started().log).toEqual([
      { turn: 1, kind: "turnStarted", seat: "seat-1" },
      { turn: 1, kind: "darkArtsRevealed", cardId: "darkarts.push" },
      { turn: 1, kind: "controlAdded", amount: 1 },
    ]);
  });

  it("records a played card, an attack, the villain defeat and the win", () => {
    let state = started();
    const played = reduce(state, { type: "playCard", cardId: "spell.zap" }, ctx("seat-1"));
    if (!played.ok) throw new Error(played.reason);
    state = played.state;
    const attacked = reduce(state, { type: "assignAttack", villainSlot: 0, amount: 3 }, ctx("seat-1"));
    if (!attacked.ok) throw new Error(attacked.reason);
    expect(attacked.state.log.slice(3)).toEqual([
      { turn: 1, kind: "cardPlayed", seat: "seat-1", cardId: "spell.zap" },
      { turn: 1, kind: "attackAssigned", seat: "seat-1", cardId: "villain.a", amount: 3 },
      { turn: 1, kind: "villainDefeated", seat: "seat-1", cardId: "villain.a" },
      { turn: 1, kind: "gameWon" },
    ]);
  });

  it("records the next turn starting when a turn ends", () => {
    const ended = reduce(started(), { type: "advancePhase" }, ctx("seat-1"));
    if (!ended.ok) throw new Error(ended.reason);
    expect(ended.state.log.slice(3)).toEqual([
      { turn: 2, kind: "turnStarted", seat: "seat-2" },
      { turn: 2, kind: "darkArtsRevealed", cardId: "darkarts.push" },
      { turn: 2, kind: "controlAdded", amount: 1 },
    ]);
  });

  it("logs nothing for a rejected action", () => {
    const state = started();
    const result = reduce(state, { type: "playCard", cardId: "spell.not-in-hand" }, ctx("seat-1"));
    expect(result.ok).toBe(false);
  });
});

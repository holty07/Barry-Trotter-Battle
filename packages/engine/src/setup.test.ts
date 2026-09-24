import { describe, expect, it } from "vitest";
import type { CardCatalog } from "./catalog.ts";
import { setup, type SetupInput } from "./setup.ts";
import { countCards } from "./testing/cardConservation.ts";

function sampleInput(overrides: Partial<SetupInput> = {}): SetupInput {
  return {
    seed: 12345,
    year: 1,
    seats: ["seat-1", "seat-2"],
    heroesBySeat: {
      "seat-1": {
        heroId: "hero.test-a",
        heroLevel: 1,
        startingDeck: Array.from({ length: 10 }, (_, i) => `spell.test-a-${i}`),
      },
      "seat-2": {
        heroId: "hero.test-b",
        heroLevel: 1,
        startingDeck: Array.from({ length: 10 }, (_, i) => `spell.test-b-${i}`),
      },
    },
    villainSlotCount: 1,
    marketRowSize: 6,
    startingHealth: 10,
    market: Array.from({ length: 30 }, (_, i) => `market.test-${i}`),
    villains: ["villain.test-a", "villain.test-b", "villain.test-c"],
    darkArts: Array.from({ length: 10 }, (_, i) => `darkarts.test-${i}`),
    locations: ["location.test-a", "location.test-b"],
    ...overrides,
  };
}

describe("setup", () => {
  it("produces a valid initial state", () => {
    const state = setup(sampleInput(), {});
    expect(state.status).toBe("playing");
    expect(state.phase).toBe("turnStart");
    expect(state.turn).toEqual({ activeSeat: "seat-1", number: 1 });
    expect(state.pending).toBeNull();
    expect(state.resolution).toEqual([]);

    for (const seat of state.seats) {
      const player = state.players[seat]!;
      expect(player.hand).toHaveLength(5);
      expect(player.deck).toHaveLength(5);
      expect(player.health).toBe(10);
      expect(player.maxHealth).toBe(10);
    }

    expect(state.market.row).toHaveLength(6);
    expect(state.market.row.every((id) => id !== null)).toBe(true);
    expect(state.villains.slots).toHaveLength(1);
    expect(state.villains.slots[0]).not.toBeNull();
  });

  it("pads villain slots with null when there are fewer villains than slots", () => {
    const state = setup(sampleInput({ villainSlotCount: 5, villains: ["villain.test-a"] }), {});
    expect(state.villains.slots).toHaveLength(5);
    expect(state.villains.slots.filter((s) => s !== null)).toHaveLength(1);
  });

  it("conserves every card across all zones", () => {
    const input = sampleInput();
    const state = setup(input, {});

    const expected = new Map<string, number>();
    for (const hero of Object.values(input.heroesBySeat)) {
      for (const id of hero.startingDeck) expected.set(id, (expected.get(id) ?? 0) + 1);
    }
    for (const id of input.market) expected.set(id, (expected.get(id) ?? 0) + 1);
    for (const id of input.villains) expected.set(id, (expected.get(id) ?? 0) + 1);
    for (const id of input.darkArts) expected.set(id, (expected.get(id) ?? 0) + 1);
    for (const id of input.locations) expected.set(id, (expected.get(id) ?? 0) + 1);

    expect(countCards(state)).toEqual(expected);
  });

  it("is deterministic for the same seed", () => {
    const a = setup(sampleInput(), {});
    const b = setup(sampleInput(), {});
    expect(a).toEqual(b);
  });

  it("produces a different shuffle for a different seed", () => {
    const a = setup(sampleInput({ seed: 1 }), {});
    const b = setup(sampleInput({ seed: 2 }), {});
    expect(a.market.row).not.toEqual(b.market.row);
  });

  it("rejects a seat with no assigned hero", () => {
    const input = sampleInput({ seats: ["seat-1", "seat-3"] });
    expect(() => setup(input, {})).toThrow(/no hero assigned for seat "seat-3"/);
  });

  it("registers the starting villain's ability as a modifier", () => {
    const catalog: CardCatalog = {
      "villain.test-a": {
        ability: [
          {
            on: "turnStarted",
            effect: { op: "noop" },
            duration: "thisTurn",
          },
        ],
      },
    };
    const state = setup(sampleInput({ villains: ["villain.test-a"] }), catalog);
    expect(state.modifiers).toHaveLength(1);
    expect(state.modifiers[0]!.source).toEqual({ kind: "villain", id: "villain.test-a" });
    expect(state.modifiers[0]!.on).toBe("turnStarted");
  });

  it("registers no modifiers for a villain with no ability", () => {
    const state = setup(sampleInput(), {});
    expect(state.modifiers).toEqual([]);
  });
});

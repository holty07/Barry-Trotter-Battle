import { describe, expect, it } from "vitest";
import { cardSchema } from "./schema/card.ts";
import { EFFECT_OPS, effectSchema } from "./schema/common.ts";
import { yearScenarioSchema } from "./schema/year.ts";
import { collectEffectOps } from "./parse.ts";

describe("cardSchema", () => {
  it("accepts a minimal valid market card", () => {
    const result = cardSchema.safeParse({
      id: "spell.test-a",
      name: "Test Spell A",
      type: "spell",
      introducedIn: 1,
      copies: 3,
      cost: 1,
      text: "Fixture.",
      effects: [{ op: "gainAttack", amount: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a card whose id doesn't match <type>.<slug>", () => {
    const result = cardSchema.safeParse({
      id: "TestSpellA",
      name: "Test Spell A",
      type: "spell",
      introducedIn: 1,
      copies: 3,
      cost: 1,
      text: "Fixture.",
      effects: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an effect with an unknown op", () => {
    const result = cardSchema.safeParse({
      id: "spell.test-a",
      name: "Test Spell A",
      type: "spell",
      introducedIn: 1,
      copies: 3,
      cost: 1,
      text: "Fixture.",
      effects: [{ op: "castUnforgivableCurse", amount: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("requires villain-only fields (health, reward) on a villain card", () => {
    const missingHealth = cardSchema.safeParse({
      id: "villain.test-a",
      name: "Test Villain A",
      type: "villain",
      introducedIn: 1,
      copies: 1,
      text: "Fixture.",
      effects: [],
      reward: [],
    });
    expect(missingHealth.success).toBe(false);
  });
});

describe("effect vocabulary coverage", () => {
  it.each(EFFECT_OPS)("op %s parses under effectSchema", (op) => {
    const result = effectSchema.safeParse(sampleEffectFor(op));
    if (!result.success) console.log(op, result.error.issues);
    expect(result.success).toBe(true);
  });
});

describe("collectEffectOps", () => {
  it("walks nested control-flow ops and finds an unknown one", () => {
    const ops = collectEffectOps({
      effects: [
        {
          op: "ifThen",
          cond: { kind: "always" },
          then: { op: "notARealOp", amount: 1 },
        },
      ],
    });
    expect(ops.has("ifThen")).toBe(true);
    expect(ops.has("notARealOp")).toBe(true);
  });
});

describe("yearScenarioSchema", () => {
  const base = {
    year: 1,
    villainSlots: 1,
    marketRowSize: 6,
    startingHealth: 10,
    locations: ["location.test-a"],
    villains: ["villain.test-a"],
    darkArts: ["darkarts.test-a"],
    market: ["spell.test-a"],
    heroLevel: 1,
    flags: { usesDice: false, usesProficiencies: false, usesHorcruxes: false },
    rulesDeltas: [],
  };

  it("accepts scalar player-count-dependent values", () => {
    expect(yearScenarioSchema.safeParse(base).success).toBe(true);
  });

  it("accepts per-player-count values", () => {
    const result = yearScenarioSchema.safeParse({
      ...base,
      villainSlots: { "2": 1, "3": 1, "4": 2 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects year 0 as a scenario (not a playable box)", () => {
    expect(yearScenarioSchema.safeParse({ ...base, year: 0 }).success).toBe(false);
  });
});

function sampleEffectFor(op: (typeof EFFECT_OPS)[number]): unknown {
  const target = { who: "controller" } as const;
  switch (op) {
    case "gainAttack":
      return { op, amount: 1 };
    case "gainInfluence":
      return { op, amount: 1 };
    case "heal":
      return { op, amount: 1, target };
    case "damage":
      return { op, amount: 1, target };
    case "draw":
      return { op, count: 1 };
    case "discard":
      return { op, count: 1, target, chooser: "controller" };
    case "moveCard":
      return { op, from: { owner: "market", zone: "deck" }, to: { owner: "market", zone: "discard" }, select: {} };
    case "revealTop":
      return { op, zone: { owner: "market", zone: "deck" }, count: 1, then: { op: "noop" } };
    case "acquireFree":
      return { op, filter: {} };
    case "addControl":
      return { op, amount: 1 };
    case "removeControl":
      return { op, amount: 1 };
    case "assignDamageToVillain":
      return { op, villain: target, amount: 1 };
    case "stun":
      return { op, target };
    case "rollDie":
      return { op, die: "test-die", then: { op: "noop" } };
    case "sequence":
      return { op, effects: [] };
    case "chooseOne":
      return { op, chooser: target, options: [{ label: "a", effect: { op: "noop" } }] };
    case "chooseTarget":
      return { op, spec: target, then: { op: "noop" } };
    case "forEach":
      return { op, over: target, effect: { op: "noop" } };
    case "ifThen":
      return { op, cond: { kind: "always" }, then: { op: "noop" } };
    case "repeat":
      return { op, times: 1, effect: { op: "noop" } };
    case "addModifier":
      return {
        op,
        modifier: {
          source: { kind: "card", id: "spell.test-a" },
          on: "cardPlayed",
          effect: { op: "noop" },
          duration: "permanent",
        },
      };
    case "adjustCounter":
      return { op, key: "test", amount: 1 };
    case "noop":
      return { op };
    default: {
      // Exhaustiveness guard: a new op added to EFFECT_OPS without a case
      // here is a compile error, not a silently-skipped test.
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

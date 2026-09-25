import { describe, expect, it } from "vitest";
import type { CardCatalog } from "./catalog.ts";
import { drain, MAX_DRAIN_ITERATIONS } from "./drain.ts";
import { evaluatePredicate } from "./resolve.ts";
import { setup } from "./setup.ts";
import type { Effect, EffectContext, GameState } from "./types.ts";

function baseState(overrides: Partial<Parameters<typeof setup>[0]> = {}): GameState {
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
    market: [
      { id: "item.cheap", cost: 1 },
      { id: "item.pricey", cost: 9 },
    ]
      .map((c) => c.id)
      .concat(Array.from({ length: 10 }, (_, i) => `market.${i}`)),
    villains: ["villain.a"],
    darkArts: Array.from({ length: 5 }, (_, i) => `darkarts.${i}`),
    locations: ["location.a"],
    ...overrides,
  }, catalog);
}

const catalog: CardCatalog = { "item.cheap": { cost: 1 }, "item.pricey": { cost: 9 }, "villain.a": { health: 5 } };

function ctxFor(state: GameState): EffectContext {
  return { source: "test.card", controller: state.turn.activeSeat, vars: {} };
}

function run(state: GameState, effect: Effect, ctx: EffectContext = ctxFor(state)): GameState {
  return drain({ ...state, resolution: [{ effect, ctx }] }, catalog);
}

describe("resolve: resources and cards", () => {
  it("gainAttack defaults to the controller", () => {
    const state = run(baseState(), { op: "gainAttack", amount: 2 });
    expect(state.players["seat-1"]!.attack).toBe(2);
  });

  it("gainAttack with an explicit target applies to every resolved seat", () => {
    const state = run(baseState(), { op: "gainAttack", amount: 1, target: { who: "allHeroes" } });
    expect(state.players["seat-1"]!.attack).toBe(1);
    expect(state.players["seat-2"]!.attack).toBe(1);
  });

  it("gainInfluence applies to the controller", () => {
    const state = run(baseState(), { op: "gainInfluence", amount: 3 });
    expect(state.players["seat-1"]!.influence).toBe(3);
  });

  it("gainInfluence with an explicit target applies to every resolved seat", () => {
    const state = run(baseState(), { op: "gainInfluence", amount: 1, target: { who: "allHeroes" } });
    expect(state.players["seat-1"]!.influence).toBe(1);
    expect(state.players["seat-2"]!.influence).toBe(1);
  });

  it("heal caps at maxHealth", () => {
    const dented = baseState();
    dented.players["seat-1"]!.health = 9;
    const state = run(dented, { op: "heal", amount: 5, target: { who: "controller" } });
    expect(state.players["seat-1"]!.health).toBe(10);
  });

  it("damage floors at 0 and stuns at 0 health", () => {
    const state = run(baseState(), { op: "damage", amount: 999, target: { who: "controller" } });
    expect(state.players["seat-1"]!.health).toBe(0);
    expect(state.players["seat-1"]!.stunned).toBe(true);
  });

  it("stunning (confirmed rule) discards half the hand rounded down and adds 1 villain control", () => {
    const withThreshold: CardCatalog = { ...catalog, "location.a": { controlSlots: 5 } };
    let before = baseState();
    before = { ...before, players: { ...before.players, "seat-1": { ...before.players["seat-1"]!, hand: ["a", "b", "c"] } } };
    const state = drain(
      { ...before, resolution: [{ effect: { op: "damage", amount: 999, target: { who: "controller" } }, ctx: ctxFor(before) }] },
      withThreshold,
    );
    expect(state.players["seat-1"]!.discard).toEqual(["a"]);
    expect(state.players["seat-1"]!.hand).toEqual(["b", "c"]);
    expect(state.locations.controlTokens).toBe(1);
  });

  it("stunning doesn't re-punish a player who is already stunned", () => {
    let before = baseState();
    before = {
      ...before,
      players: { ...before.players, "seat-1": { ...before.players["seat-1"]!, stunned: true, health: 0, hand: ["a", "b"] } },
    };
    const state = run(before, { op: "damage", amount: 1, target: { who: "controller" } });
    expect(state.players["seat-1"]!.hand).toEqual(["a", "b"]);
    expect(state.locations.controlTokens).toBe(0);
  });

  it("a stunned player can still gain attack/influence — there's no ongoing suppression", () => {
    let before = baseState();
    before = { ...before, players: { ...before.players, "seat-2": { ...before.players["seat-2"]!, stunned: true } } };
    const state = run(before, { op: "gainAttack", amount: 3, target: { who: "allHeroes" } }, ctxFor(before));
    expect(state.players["seat-2"]!.attack).toBe(3);
  });

  it("becoming stunned discards accrued attack/influence, even on another player's turn", () => {
    let before = baseState();
    before = {
      ...before,
      turn: { ...before.turn, activeSeat: "seat-1" },
      players: { ...before.players, "seat-2": { ...before.players["seat-2"]!, attack: 4, influence: 2 } },
    };
    const state = run(before, { op: "damage", amount: 999, target: { who: "allHeroes" } }, ctxFor(before));
    expect(state.players["seat-2"]!.stunned).toBe(true);
    expect(state.players["seat-2"]!.attack).toBe(0);
    expect(state.players["seat-2"]!.influence).toBe(0);
  });

  it("becoming stunned discards accrued attack/influence even on your own turn (rare, but some villain effects can do it)", () => {
    let before = baseState();
    before = {
      ...before,
      players: { ...before.players, "seat-1": { ...before.players["seat-1"]!, attack: 4, influence: 2 } },
    };
    const state = run(before, { op: "damage", amount: 999, target: { who: "controller" } }, ctxFor(before));
    expect(state.players["seat-1"]!.stunned).toBe(true);
    expect(state.players["seat-1"]!.attack).toBe(0);
    expect(state.players["seat-1"]!.influence).toBe(0);
  });

  it("damage has no effect on an already-stunned player's health", () => {
    let before = baseState();
    before = { ...before, players: { ...before.players, "seat-1": { ...before.players["seat-1"]!, stunned: true, health: 7 } } };
    const state = run(before, { op: "damage", amount: 5, target: { who: "controller" } });
    expect(state.players["seat-1"]!.health).toBe(7);
  });

  it("heal has no effect on a stunned player", () => {
    let before = baseState();
    before = { ...before, players: { ...before.players, "seat-1": { ...before.players["seat-1"]!, stunned: true, health: 3 } } };
    const state = run(before, { op: "heal", amount: 5, target: { who: "controller" } });
    expect(state.players["seat-1"]!.health).toBe(3);
  });

  it("draw moves cards from deck to hand", () => {
    const before = baseState();
    const handBefore = before.players["seat-1"]!.hand.length;
    const state = run(before, { op: "draw", count: 2 });
    expect(state.players["seat-1"]!.hand).toHaveLength(handBefore + 2);
  });

  it("draw reshuffles the discard pile when the deck runs out", () => {
    let state = baseState();
    const seat1 = state.players["seat-1"]!;
    state = { ...state, players: { ...state.players, "seat-1": { ...seat1, deck: [], discard: ["spell.x", "spell.y"] } } };
    state = run(state, { op: "draw", count: 2 });
    expect(state.players["seat-1"]!.hand.length).toBeGreaterThanOrEqual(2);
    expect(state.players["seat-1"]!.discard).toEqual([]);
  });

  it("discard moves the front N cards from hand to discard", () => {
    const before = baseState();
    const hand = before.players["seat-1"]!.hand;
    const state = run(before, { op: "discard", count: 1, target: { who: "controller" }, chooser: "controller" });
    expect(state.players["seat-1"]!.hand).toEqual(hand.slice(1));
    expect(state.players["seat-1"]!.discard).toEqual([hand[0]]);
  });

  it("moveCard with matchAll empties the from-zone into the to-zone", () => {
    const state = run(baseState(), {
      op: "moveCard",
      from: { owner: "market", zone: "deck" },
      to: { owner: "market", zone: "discard" },
      select: { matchAll: true },
    });
    expect(state.market.deck).toEqual([]);
    expect(state.market.discard.length).toBeGreaterThan(0);
  });

  it("revealTop leaves cards in place and runs `then`", () => {
    const state = run(baseState(), {
      op: "revealTop",
      zone: { owner: "market", zone: "deck" },
      count: 1,
      then: {
        op: "moveCard",
        from: { owner: "market", zone: "deck" },
        to: { owner: "market", zone: "discard" },
        select: { matchAll: true },
      },
    });
    expect(state.market.deck).toEqual([]);
  });

  it("acquireFree takes the first market-row card within budget", () => {
    let state = baseState();
    state = { ...state, market: { ...state.market, row: ["item.pricey", "item.cheap", ...state.market.row.slice(2)] } };
    const result = run(state, { op: "acquireFree", filter: {}, maxCost: 2 });
    expect(result.players["seat-1"]!.discard).toContain("item.cheap");
    expect(result.market.row).not.toContain("item.cheap");
  });

  it("acquireFree is a no-op when nothing qualifies", () => {
    let state = baseState();
    state = { ...state, market: { ...state.market, row: new Array(6).fill("item.pricey") } };
    const result = run(state, { op: "acquireFree", filter: {}, maxCost: 2 });
    expect(result.players["seat-1"]!.discard).toEqual([]);
  });
});

describe("resolve: board effects", () => {
  it("addControl / removeControl adjust locations.controlTokens, floored at 0", () => {
    let state = run(baseState(), { op: "addControl", amount: 3 });
    expect(state.locations.controlTokens).toBe(3);
    state = run(state, { op: "removeControl", amount: 10 });
    expect(state.locations.controlTokens).toBe(0);
  });

  it("addControl emits controlAdded, triggering a registered modifier (a villain that punishes control being added)", () => {
    let state = baseState();
    state = {
      ...state,
      modifiers: [
        {
          id: "test-control-punisher",
          source: { kind: "villain", id: "villain.a" },
          on: "controlAdded",
          effect: { op: "damage", amount: 2, target: { who: "activePlayer" } },
          duration: "whileSourceActive",
        },
      ],
    };
    const result = run(state, { op: "addControl", amount: 1 });
    expect(result.players["seat-1"]!.health).toBe(8);
  });

  it("addControl advances to the next location once controlSlots is reached", () => {
    const withTwoLocations: CardCatalog = { ...catalog, "location.a": { controlSlots: 2 } };
    const state = drain(
      { ...baseState({ locations: ["location.a", "location.b"] }), resolution: [{ effect: { op: "addControl", amount: 2 }, ctx: ctxFor(baseState()) }] },
      withTwoLocations,
    );
    expect(state.locations.current).toBe(1);
    expect(state.locations.controlTokens).toBe(0);
    expect(state.status).toBe("playing");
  });

  it("addControl loses the game once the last location's control fills up", () => {
    const withOneLocation: CardCatalog = { ...catalog, "location.a": { controlSlots: 2 } };
    const state = drain(
      { ...baseState(), resolution: [{ effect: { op: "addControl", amount: 2 }, ctx: ctxFor(baseState()) }] },
      withOneLocation,
    );
    expect(state.status).toBe("lost");
  });

  it("stun sets the target's stunned flag — the raw docs/02 primitive, no card uses it", () => {
    const before = baseState();
    const state = run(before, { op: "stun", target: { who: "controller" } }, ctxFor(before));
    expect(state.players["seat-1"]!.stunned).toBe(true);
    expect(state.players["seat-1"]!.discard).toEqual([]);
    expect(state.locations.controlTokens).toBe(0);
  });

  it("rollDie binds ctx.vars.dieValue for `then`", () => {
    const state = run(baseState(), {
      op: "rollDie",
      die: "test-die",
      then: { op: "gainAttack", amount: 1 },
    });
    // the roll itself just needs to have happened deterministically and not crash;
    // the `then` effect ran, which is the observable proof.
    expect(state.players["seat-1"]!.attack).toBe(1);
  });

  it("assignDamageToVillain damages the bound villain slot", () => {
    const state = run(baseState(), {
      op: "chooseTarget",
      spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
      then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 2 },
    });
    expect(state.villains.slots[0]!.damageTaken).toBe(2);
  });

  it("assignDamageToVillain defeats the villain once damage reaches its catalog health, and wins if none remain", () => {
    const state = run(baseState(), {
      op: "chooseTarget",
      spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
      then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 5 },
    });
    expect(state.villains.slots[0]).toBeNull();
    expect(state.villains.defeated).toEqual(["villain.a"]);
    expect(state.status).toBe("won");
    expect(state.counters["villainsDefeated"]).toBe(1);
  });

  it("assignDamageToVillain refills the slot from the deck and registers the new villain's ability", () => {
    const withMoreVillains: CardCatalog = {
      ...catalog,
      "villain.a": { health: 5, ability: [{ on: "turnStarted", effect: { op: "noop" }, duration: "thisTurn" }] },
      "villain.b": { health: 5, ability: [{ on: "turnStarted", effect: { op: "noop" }, duration: "thisTurn" }] },
    };
    const initial = baseState({ villains: ["villain.a", "villain.b"] });
    const startingVillain = initial.villains.slots[0]!.cardId;
    const refillVillain = initial.villains.deck[0]!;

    const state = drain(
      {
        ...initial,
        resolution: [
          {
            effect: {
              op: "chooseTarget",
              spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
              then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 5 },
            },
            ctx: ctxFor(initial),
          },
        ],
      },
      withMoreVillains,
    );
    expect(state.villains.defeated).toEqual([startingVillain]);
    expect(state.villains.slots[0]).not.toBeNull();
    expect(state.villains.slots[0]!.cardId).toBe(refillVillain);
    expect(state.villains.deck).toEqual([]);
    expect(state.status).toBe("playing");
    expect(state.modifiers.some((m) => m.source.kind === "villain" && m.source.id === refillVillain)).toBe(true);
    expect(state.modifiers.some((m) => m.source.kind === "villain" && m.source.id === startingVillain)).toBe(false);
  });

  it("assignDamageToVillain drops the defeated villain's own ability modifiers", () => {
    const withAbility: CardCatalog = {
      ...catalog,
      "villain.a": { ...catalog["villain.a"], ability: [{ on: "turnStarted", effect: { op: "noop" }, duration: "thisTurn" }] },
    };
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
        market: Array.from({ length: 10 }, (_, i) => `market.${i}`),
        villains: ["villain.a"],
        darkArts: Array.from({ length: 5 }, (_, i) => `darkarts.${i}`),
        locations: ["location.a"],
      },
      withAbility,
    );
    expect(state.modifiers).toHaveLength(1);
    const defeated = drain(
      {
        ...state,
        resolution: [
          {
            effect: {
              op: "chooseTarget",
              spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
              then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 5 },
            },
            ctx: ctxFor(state),
          },
        ],
      },
      withAbility,
    );
    expect(defeated.modifiers).toEqual([]);
  });

  it("assignDamageToVillain pushes the villain's reward effects", () => {
    const withReward: CardCatalog = { ...catalog, "villain.a": { ...catalog["villain.a"], reward: [{ op: "gainInfluence", amount: 3 }] } };
    const state = drain(
      { ...baseState(), resolution: [{
        effect: {
          op: "chooseTarget",
          spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
          then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 5 },
        },
        ctx: ctxFor(baseState()),
      }] },
      withReward,
    );
    expect(state.players["seat-1"]!.influence).toBe(3);
  });

  it("assignDamageToVillain emits villainDefeated, triggering a reaction owned by whoever played it (an 'if you defeat a villain' item)", () => {
    // seat-2 played the reactive item, seat-1 is the active player who
    // actually defeats the villain — the bonus must land on seat-2.
    let state = baseState();
    state = run(
      state,
      {
        op: "addModifier",
        modifier: { source: { kind: "card", id: "item.test-defeat-bonus" }, on: "villainDefeated", effect: { op: "gainInfluence", amount: 1 }, duration: "thisTurn" },
      },
      { source: "item.test-defeat-bonus", controller: "seat-2", vars: {} },
    );
    state = run(state, {
      op: "chooseTarget",
      spec: { who: "choose", from: "activeVillains", chooser: { who: "controller" } },
      then: { op: "assignDamageToVillain", villain: { who: "target" }, amount: 5 },
    });
    expect(state.players["seat-2"]!.influence).toBe(1);
    expect(state.players["seat-1"]!.influence).toBe(0);
  });

  it("assignDamageToVillain throws with no bound target", () => {
    expect(() => run(baseState(), { op: "assignDamageToVillain", villain: { who: "target" }, amount: 1 })).toThrow(
      /no villain bound/,
    );
  });
});

describe("resolve: control flow", () => {
  it("sequence applies effects in order", () => {
    const state = run(baseState(), {
      op: "sequence",
      effects: [
        { op: "gainAttack", amount: 1 },
        { op: "gainInfluence", amount: 2 },
      ],
    });
    expect(state.players["seat-1"]!.attack).toBe(1);
    expect(state.players["seat-1"]!.influence).toBe(2);
  });

  it("ifThen runs `then` when the predicate is true", () => {
    const state = run(baseState(), {
      op: "ifThen",
      cond: { kind: "always" },
      then: { op: "gainAttack", amount: 5 },
    });
    expect(state.players["seat-1"]!.attack).toBe(5);
  });

  it("ifThen runs `else` when the predicate is false", () => {
    const state = run(baseState(), {
      op: "ifThen",
      cond: { kind: "not", of: { kind: "always" } },
      then: { op: "gainAttack", amount: 5 },
      else: { op: "gainInfluence", amount: 7 },
    });
    expect(state.players["seat-1"]!.attack).toBe(0);
    expect(state.players["seat-1"]!.influence).toBe(7);
  });

  it("repeat runs the effect N times", () => {
    const state = run(baseState(), { op: "repeat", times: 4, effect: { op: "gainAttack", amount: 1 } });
    expect(state.players["seat-1"]!.attack).toBe(4);
  });

  it("forEach binds the target per iteration for {who:\"target\"}", () => {
    const state = run(baseState(), {
      op: "forEach",
      over: { who: "each", from: "heroes" },
      effect: { op: "gainAttack", amount: 1, target: { who: "target" } },
    });
    expect(state.players["seat-1"]!.attack).toBe(1);
    expect(state.players["seat-2"]!.attack).toBe(1);
  });

  it("chooseOne auto-resolves a single option without pausing", () => {
    const state = run(baseState(), {
      op: "chooseOne",
      chooser: { who: "controller" },
      options: [{ label: "only", effect: { op: "gainAttack", amount: 1 } }],
    });
    expect(state.pending).toBeNull();
    expect(state.players["seat-1"]!.attack).toBe(1);
  });

  it("chooseOne pauses with a pending input when there's more than one option", () => {
    const state = run(baseState(), {
      op: "chooseOne",
      chooser: { who: "controller" },
      options: [
        { label: "attack", effect: { op: "gainAttack", amount: 1 } },
        { label: "influence", effect: { op: "gainInfluence", amount: 1 } },
      ],
    });
    expect(state.pending).not.toBeNull();
    expect(state.pending!.seat).toBe("seat-1");
    expect(state.resolution).toEqual([]);
  });

  it("chooseTarget auto-binds when there's exactly one candidate", () => {
    const state = run(baseState(), {
      op: "chooseTarget",
      spec: { who: "choose", from: "otherHeroes", chooser: { who: "controller" } },
      then: { op: "gainAttack", amount: 1, target: { who: "target" } },
    });
    expect(state.pending).toBeNull();
    expect(state.players["seat-2"]!.attack).toBe(1);
  });

  it("chooseTarget pauses with a pending input when there's more than one candidate", () => {
    const state = run(baseState(), {
      op: "chooseTarget",
      spec: { who: "choose", from: "anyHero", chooser: { who: "controller" } },
      then: { op: "gainAttack", amount: 1, target: { who: "target" } },
    });
    expect(state.pending).not.toBeNull();
    expect(state.pending!.options).toHaveLength(2);
  });

  it("addModifier appends a modifier with a generated id", () => {
    const state = run(baseState(), {
      op: "addModifier",
      modifier: {
        source: { kind: "card", id: "test.card" },
        on: "cardPlayed",
        effect: { op: "noop" },
        duration: "permanent",
      },
    });
    expect(state.modifiers).toHaveLength(1);
    expect(state.modifiers[0]!.id).toBeTruthy();
  });

  it("addModifier defaults source to the resolving card, like it already does for controller (a card registering its own reaction)", () => {
    const state = run(baseState(), { op: "addModifier", modifier: { on: "cardAcquired", effect: { op: "noop" }, duration: "thisTurn" } }, ctxFor(baseState()));
    expect(state.modifiers[0]!.source).toEqual({ kind: "card", id: "test.card" });
    expect(state.modifiers[0]!.controller).toBe("seat-1");
  });

  it("noop does nothing", () => {
    const before = baseState();
    const state = run(before, { op: "noop" });
    expect(state.players).toEqual(before.players);
  });
});

describe("resolve: vocabulary extensions (M2c real-content pass)", () => {
  it("adjustCounter reads back via a {counter} CountableRef (a 'for each ally played' card)", () => {
    let state = baseState();
    state = { ...state, counters: { "played:ally": 3 } };
    state = run(state, { op: "gainAttack", amount: { expr: "count", of: { counter: "played:ally" } } });
    expect(state.players["seat-1"]!.attack).toBe(3);
  });

  it("adjustCounter sets/increments a named counter", () => {
    let state = run(baseState(), { op: "adjustCounter", key: "drawsBlocked", amount: 1 });
    expect(state.counters["drawsBlocked"]).toBe(1);
    state = run(state, { op: "adjustCounter", key: "drawsBlocked", amount: 1 });
    expect(state.counters["drawsBlocked"]).toBe(2);
  });

  it("draw is blocked while drawsBlocked is set (a Dark Arts event that blocks extra draws)", () => {
    let state = baseState();
    state = { ...state, counters: { drawsBlocked: 1 } };
    const before = state.players["seat-1"]!.hand.length;
    state = run(state, { op: "draw", count: 3 });
    expect(state.players["seat-1"]!.hand).toHaveLength(before);
  });

  it("moveCard with fromEvent moves exactly the card named on the triggering event, on top of the deck", () => {
    let state = baseState();
    state = {
      ...state,
      players: { ...state.players, "seat-1": { ...state.players["seat-1"]!, discard: ["other.card", "item.time-turner"] } },
    };
    const result = drain(
      {
        ...state,
        resolution: [
          {
            effect: {
              op: "moveCard",
              from: { owner: { who: "controller" }, zone: "discard" },
              to: { owner: { who: "controller" }, zone: "deck" },
              select: { fromEvent: true },
            },
            ctx: { source: "item.time-turner", controller: "seat-1", vars: { event: { cardId: "item.time-turner" } } },
          },
        ],
      },
      catalog,
    );
    expect(result.players["seat-1"]!.discard).toEqual(["other.card"]);
    expect(result.players["seat-1"]!.deck[0]).toBe("item.time-turner");
  });

  it("moveCard with fromEvent is a no-op if the named card isn't in the from-zone", () => {
    const before = baseState();
    const result = drain(
      {
        ...before,
        resolution: [
          {
            effect: {
              op: "moveCard",
              from: { owner: { who: "controller" }, zone: "discard" },
              to: { owner: { who: "controller" }, zone: "deck" },
              select: { fromEvent: true },
            },
            ctx: { source: "item.time-turner", controller: "seat-1", vars: { event: { cardId: "item.time-turner" } } },
          },
        ],
      },
      catalog,
    );
    expect(result).toEqual(before);
  });

  it("discard emits cardDiscarded per card, triggering a source-type-conditioned reaction targeting the event's seat (a villain that punishes discards)", () => {
    const withDiscardPunisher: CardCatalog = { ...catalog, "darkarts.test-discard": { type: "darkArts" } };
    let state = baseState();
    state = {
      ...state,
      modifiers: [
        {
          id: "test-discard-punisher",
          source: { kind: "villain", id: "villain.test-discard-punisher" },
          on: "cardDiscarded",
          condition: { kind: "or", of: [{ kind: "cardTypeIs", ref: "eventSource", cardType: "darkArts" }, { kind: "cardTypeIs", ref: "eventSource", cardType: "villain" }] },
          effect: { op: "damage", amount: 1, target: { who: "eventSeat" } },
          duration: "whileSourceActive",
        },
      ],
    };
    const result = drain(
      {
        ...state,
        resolution: [
          {
            effect: { op: "discard", count: 1, target: { who: "activePlayer" }, chooser: "target" },
            ctx: { source: "darkarts.test-discard", controller: "seat-1", vars: {} },
          },
        ],
      },
      withDiscardPunisher,
    );
    expect(result.players["seat-1"]!.health).toBe(9); // 10 - 1 from the villain's reaction
  });

  it("discard's cardDiscarded reaction does not fire for a player's own voluntary discard (not sourced from darkArts/villain)", () => {
    const withDiscardPunisher: CardCatalog = { ...catalog, "spell.test-voluntary-discard": { type: "spell" } };
    let state = baseState();
    state = {
      ...state,
      modifiers: [
        {
          id: "test-discard-punisher",
          source: { kind: "villain", id: "villain.test-discard-punisher" },
          on: "cardDiscarded",
          condition: { kind: "or", of: [{ kind: "cardTypeIs", ref: "eventSource", cardType: "darkArts" }, { kind: "cardTypeIs", ref: "eventSource", cardType: "villain" }] },
          effect: { op: "damage", amount: 1, target: { who: "eventSeat" } },
          duration: "whileSourceActive",
        },
      ],
    };
    const result = drain(
      {
        ...state,
        resolution: [
          {
            effect: { op: "discard", count: 1, target: { who: "controller" }, chooser: "controller" },
            ctx: { source: "spell.test-voluntary-discard", controller: "seat-1", vars: {} },
          },
        ],
      },
      withDiscardPunisher,
    );
    expect(result.players["seat-1"]!.health).toBe(10);
  });

  it("eventCardIsSource predicate matches only when the event's card is the reacting card itself", () => {
    const state = baseState();
    const ctxSelf = { source: "item.test-discard-bonus", controller: "seat-1", vars: { event: { cardId: "item.test-discard-bonus" } } };
    const ctxOther = { source: "item.test-discard-bonus", controller: "seat-1", vars: { event: { cardId: "spell.other" } } };
    expect(evaluatePredicate(state, { kind: "eventCardIsSource" }, ctxSelf, catalog)).toBe(true);
    expect(evaluatePredicate(state, { kind: "eventCardIsSource" }, ctxOther, catalog)).toBe(false);
  });
});

describe("resolve: invariants", () => {
  it("never leaves resolution non-empty with pending null", () => {
    const state = run(baseState(), {
      op: "chooseOne",
      chooser: { who: "controller" },
      options: [
        { label: "a", effect: { op: "noop" } },
        { label: "b", effect: { op: "noop" } },
      ],
    });
    expect(state.resolution.length === 0 || state.pending !== null).toBe(true);
  });

  it("caps drain iterations rather than looping forever", () => {
    expect(() =>
      run(baseState(), { op: "repeat", times: MAX_DRAIN_ITERATIONS + 1, effect: { op: "noop" } }),
    ).toThrow(/exceeded/);
  });
});

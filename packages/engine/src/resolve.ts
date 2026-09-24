import type { CardCatalog } from "./catalog.ts";
import { nextInt, shuffle } from "./rng.ts";
import { villainAbilityModifiers } from "./setup.ts";
import { candidatesFor, resolveSeats } from "./target.ts";
import type {
  Amount,
  BoundTarget,
  EffectContext,
  Frame,
  GameState,
  Modifier,
  PendingInput,
  Predicate,
  SeatId,
} from "./types.ts";
import { getZoneCards, setZoneCards } from "./zones.ts";

export type ApplyResult = { state: GameState; newFrames?: Frame[]; pending?: PendingInput };

function nextPendingId(state: GameState): [string, GameState] {
  const seq = (state.counters["__pendingSeq"] ?? 0) + 1;
  return [`pending-${seq}`, { ...state, counters: { ...state.counters, __pendingSeq: seq } }];
}

// ponytail: a count expression only counts cards in its selector's `zone`;
// `types`/`matchAll` filters are ignored until a real card needs them (none
// of the effect vocabulary's docs/02 example needs more than this).
function resolveAmount(state: GameState, amount: Amount, ctx: EffectContext): number {
  if (typeof amount === "number") return amount;
  const { zone } = amount.of.matching;
  if (!zone) throw new Error('resolveAmount: a count expression needs its selector to have a "zone" for now');
  return getZoneCards(state, zone, ctx).length;
}

export function evaluatePredicate(state: GameState, pred: Predicate, ctx: EffectContext): boolean {
  switch (pred.kind) {
    case "always":
      return true;
    case "not":
      return !evaluatePredicate(state, pred.of, ctx);
    case "and":
      return pred.of.every((p) => evaluatePredicate(state, p, ctx));
    case "or":
      return pred.of.some((p) => evaluatePredicate(state, p, ctx));
    case "countAtLeast": {
      const { zone } = pred.ref.matching;
      if (!zone) throw new Error('evaluatePredicate: countAtLeast needs its selector to have a "zone" for now');
      return getZoneCards(state, zone, ctx).length >= pred.amount;
    }
  }
}

// Shared by `addControl` and the on-stun control gain below: adds to the
// active location's control tokens, advancing to the next location (and
// losing the game if there isn't one) once its controlSlots is reached.
function applyControlGain(state: GameState, catalog: CardCatalog, amount: number): GameState {
  let controlTokens = state.locations.controlTokens + amount;
  let current = state.locations.current;
  let status = state.status;
  const threshold = catalog[state.locations.order[current]!]?.controlSlots;
  if (threshold !== undefined && controlTokens >= threshold) {
    current += 1;
    controlTokens = 0;
    if (current >= state.locations.order.length) status = "lost";
  }
  return { ...state, status, locations: { ...state.locations, current, controlTokens } };
}

// What happens when a hero's health hits 0 (confirmed by the project
// owner): add 1 villain control to the location, discard half the hand
// (rounded down), and discard any accrued attack/influence unconditionally
// — even in the rare case (some villain effects) of being stunned on your
// own turn, that turn's gains are still lost. Healing to full and clearing
// `stunned` happens at the end of this player's own next turn. A no-op if
// the player is already stunned — being stunned twice isn't punished
// twice. Gaining attack/influence while stunned is otherwise unaffected —
// there's no ongoing suppression.
function applyStun(state: GameState, catalog: CardCatalog, seat: SeatId): GameState {
  const player = state.players[seat]!;
  if (player.stunned) return state;

  const discardCount = Math.floor(player.hand.length / 2);
  const stunned: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...player,
        stunned: true,
        attack: 0,
        influence: 0,
        hand: player.hand.slice(discardCount),
        discard: [...player.discard, ...player.hand.slice(0, discardCount)],
      },
    },
  };
  return applyControlGain(stunned, catalog, 1);
}

function drawCards(state: GameState, seat: SeatId, count: number): GameState {
  const player = state.players[seat];
  if (!player) throw new Error(`drawCards: unknown seat "${seat}"`);
  let deck = [...player.deck];
  let discard = [...player.discard];
  const hand = [...player.hand];
  let rng = state.rng;
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const [shuffled, nextRng] = shuffle(discard, rng);
      rng = nextRng;
      deck = shuffled;
      discard = [];
    }
    hand.push(deck.shift()!);
  }
  return { ...state, rng, players: { ...state.players, [seat]: { ...player, deck, discard, hand } } };
}

/**
 * Applies one effect: mutates (structurally) game state and/or returns
 * further frames to push, or pauses with a PendingInput. Never throws for
 * game-state reasons a player could trigger — only for authoring bugs
 * (unresolvable targets, unsupported zones).
 */
export function applyEffect(state: GameState, frame: Frame, catalog: CardCatalog): ApplyResult {
  const { effect, ctx } = frame;

  switch (effect.op) {
    case "noop":
      return { state };

    case "gainAttack": {
      const seats = effect.target ? resolveSeats(state, effect.target, ctx) : [ctx.controller];
      const amount = resolveAmount(state, effect.amount, ctx);
      let next = state;
      for (const seat of seats) {
        const player = next.players[seat]!;
        next = { ...next, players: { ...next.players, [seat]: { ...player, attack: player.attack + amount } } };
      }
      return { state: next };
    }

    case "gainInfluence": {
      const amount = resolveAmount(state, effect.amount, ctx);
      const seat = ctx.controller;
      const player = state.players[seat]!;
      return {
        state: { ...state, players: { ...state.players, [seat]: { ...player, influence: player.influence + amount } } },
      };
    }

    case "heal": {
      // Confirmed by the project owner: a stunned hero can't gain health.
      const seats = resolveSeats(state, effect.target, ctx);
      const amount = resolveAmount(state, effect.amount, ctx);
      let next = state;
      for (const seat of seats) {
        const player = next.players[seat]!;
        if (player.stunned) continue;
        const health = Math.min(player.maxHealth, player.health + amount);
        next = { ...next, players: { ...next.players, [seat]: { ...player, health } } };
      }
      return { state: next };
    }

    case "damage": {
      // Confirmed by the project owner: a stunned hero stops losing health.
      const seats = resolveSeats(state, effect.target, ctx);
      const amount = resolveAmount(state, effect.amount, ctx);
      let next = state;
      for (const seat of seats) {
        const player = next.players[seat]!;
        if (player.stunned) continue;
        const health = Math.max(0, player.health - amount);
        next = { ...next, players: { ...next.players, [seat]: { ...player, health } } };
        if (health === 0) next = applyStun(next, catalog, seat);
      }
      return { state: next };
    }

    case "draw": {
      const seats = effect.target ? resolveSeats(state, effect.target, ctx) : [ctx.controller];
      const count = resolveAmount(state, effect.count, ctx);
      let next = state;
      for (const seat of seats) next = drawCards(next, seat, count);
      return { state: next };
    }

    case "discard": {
      // ponytail: always discards from the front of hand, ignoring
      // `chooser` — a real chooser="target" pending-choice flow can reuse
      // chooseOne's machinery once a card needs it.
      const seats = resolveSeats(state, effect.target, ctx);
      const count = resolveAmount(state, effect.count, ctx);
      let next = state;
      for (const seat of seats) {
        const player = next.players[seat]!;
        const toDiscard = player.hand.slice(0, count);
        const hand = player.hand.slice(count);
        next = {
          ...next,
          players: { ...next.players, [seat]: { ...player, hand, discard: [...player.discard, ...toDiscard] } },
        };
      }
      return { state: next };
    }

    case "moveCard": {
      if (!effect.select.matchAll) {
        throw new Error("moveCard: only { matchAll: true } is supported for now");
      }
      const fromCards = getZoneCards(state, effect.from, ctx);
      const toCards = getZoneCards(state, effect.to, ctx);
      let next = setZoneCards(state, effect.from, ctx, []);
      next = setZoneCards(next, effect.to, ctx, [...toCards, ...fromCards]);
      return { state: next };
    }

    case "revealTop": {
      // Revealed cards stay where they are; `then` acts on them via the
      // same zone ref (matches the one fixture that uses this: reveal top,
      // then moveCard out of the same zone).
      return { state, newFrames: [{ effect: effect.then, ctx }] };
    }

    case "acquireFree": {
      // ponytail: auto-acquires the first qualifying market-row card
      // instead of asking the player to choose among several — add a
      // pending choice (chooseOne already proves the machinery) once a
      // real card needs to pick among more than one.
      const maxCost = Math.min(effect.maxCost ?? Infinity, effect.filter.maxCost ?? Infinity);
      const index = state.market.row.findIndex(
        (cardId) => cardId !== null && (catalog[cardId]?.cost ?? Infinity) <= maxCost,
      );
      if (index === -1) return { state };
      const cardId = state.market.row[index]!;
      const row = [...state.market.row];
      row[index] = null;
      const player = state.players[ctx.controller]!;
      return {
        state: {
          ...state,
          market: { ...state.market, row },
          players: { ...state.players, [ctx.controller]: { ...player, discard: [...player.discard, cardId] } },
        },
      };
    }

    case "addControl": {
      // docs/02's GameState shape (`locations.current` indexing `order`)
      // implies the loss condition directly: filling the active location's
      // controlSlots advances to the next one, and running out of locations
      // is a loss. TODO(rules): confirm this against the manual — the
      // threshold comparison (>=) and reset-to-0 behaviour are inferred.
      const amount = resolveAmount(state, effect.amount, ctx);
      return { state: applyControlGain(state, catalog, amount) };
    }

    case "removeControl":
      return {
        state: {
          ...state,
          locations: {
            ...state.locations,
            controlTokens: Math.max(0, state.locations.controlTokens - resolveAmount(state, effect.amount, ctx)),
          },
        },
      };

    case "stun": {
      // docs/02's raw primitive, unchanged: no real card actually uses this
      // op (stunning only ever happens via health hitting 0 in `damage`),
      // so it stays exactly what docs/02 specs rather than carrying
      // inferred consequences nothing exercises.
      const seats = resolveSeats(state, effect.target, ctx);
      let next = state;
      for (const seat of seats) {
        const player = next.players[seat]!;
        next = { ...next, players: { ...next.players, [seat]: { ...player, stunned: true } } };
      }
      return { state: next };
    }

    case "rollDie": {
      const [value, rng] = nextInt(state.rng, 6);
      const nextCtx: EffectContext = { ...ctx, vars: { ...ctx.vars, dieValue: value } };
      return { state: { ...state, rng }, newFrames: [{ effect: effect.then, ctx: nextCtx }] };
    }

    case "assignDamageToVillain": {
      if (effect.villain.who !== "target") {
        throw new Error('assignDamageToVillain: only {who:"target"} is supported — choose the villain with chooseTarget first');
      }
      const bound = ctx.vars["boundTarget"] as BoundTarget | undefined;
      if (!bound || bound.kind !== "villainSlot") {
        throw new Error("assignDamageToVillain: no villain bound — use chooseTarget first");
      }
      const slot = state.villains.slots[bound.index];
      if (!slot) throw new Error(`assignDamageToVillain: slot ${bound.index} is empty`);
      const amount = resolveAmount(state, effect.amount, ctx);
      const damageTaken = slot.damageTaken + amount;
      const health = catalog[slot.cardId]?.health;
      const slots = [...state.villains.slots];

      if (health === undefined || damageTaken < health) {
        slots[bound.index] = { ...slot, damageTaken };
        return { state: { ...state, villains: { ...state.villains, slots } } };
      }

      // Defeated: drop this villain's ability modifiers, refill the slot
      // from the deck if one remains (registering its ability too), push
      // the reward effects, and check the win condition.
      const defeated = [...state.villains.defeated, slot.cardId];
      const modifiers = state.modifiers.filter(
        (m) => !(m.source.kind === "villain" && m.source.id === slot.cardId),
      );
      let deck = state.villains.deck;
      if (deck.length > 0) {
        const [refillId, ...rest] = deck;
        slots[bound.index] = { cardId: refillId!, damageTaken: 0 };
        deck = rest;
        modifiers.push(...villainAbilityModifiers(refillId!, catalog, `refill-${defeated.length}`));
      } else {
        slots[bound.index] = null;
      }

      const status = slots.every((s) => s === null) && deck.length === 0 ? "won" : state.status;
      const counters = { ...state.counters, villainsDefeated: (state.counters["villainsDefeated"] ?? 0) + 1 };
      const rewardEffects = catalog[slot.cardId]?.reward ?? [];

      return {
        state: { ...state, status, counters, modifiers, villains: { ...state.villains, slots, defeated, deck } },
        newFrames: rewardEffects.map((rewardEffect) => ({ effect: rewardEffect, ctx })),
      };
    }

    case "sequence":
      return { state, newFrames: effect.effects.map((e) => ({ effect: e, ctx })) };

    case "ifThen": {
      const chosen = evaluatePredicate(state, effect.cond, ctx) ? effect.then : effect.else;
      return { state, newFrames: chosen ? [{ effect: chosen, ctx }] : [] };
    }

    case "repeat": {
      const times = Math.max(0, resolveAmount(state, effect.times, ctx));
      return { state, newFrames: Array.from({ length: times }, () => ({ effect: effect.effect, ctx })) };
    }

    case "forEach": {
      if (!("who" in effect.over)) {
        throw new Error("forEach: CardSelector-based iteration isn't supported yet — no fixture needs it");
      }
      const targets: BoundTarget[] = resolveSeats(state, effect.over, ctx).map((seat) => ({ kind: "seat", seat }));
      const newFrames = targets.map((target) => ({
        effect: effect.effect,
        ctx: { ...ctx, vars: { ...ctx.vars, boundTarget: target } },
      }));
      return { state, newFrames };
    }

    case "addModifier": {
      const seq = (state.counters["__modifierSeq"] ?? 0) + 1;
      const modifier: Modifier = { ...effect.modifier, id: `modifier-${seq}` };
      return {
        state: { ...state, modifiers: [...state.modifiers, modifier], counters: { ...state.counters, __modifierSeq: seq } },
      };
    }

    case "chooseOne": {
      if (effect.options.length === 1) {
        return { state, newFrames: [{ effect: effect.options[0]!.effect, ctx }] };
      }
      const chooserSeat = resolveSeats(state, effect.chooser, ctx)[0];
      if (!chooserSeat) throw new Error("chooseOne: chooser resolved to no seat");
      const [id, stateWithId] = nextPendingId(state);
      const pending: PendingInput = {
        id,
        seat: chooserSeat,
        prompt: { key: "chooseOne" },
        minChoices: 1,
        maxChoices: 1,
        options: effect.options.map((option, index) => ({ id: String(index), label: option.label })),
        resume: { kind: "chooseOne", ctx, chosenEffects: effect.options.map((o) => o.effect) },
      };
      return { state: stateWithId, pending };
    }

    case "chooseTarget": {
      if (effect.spec.who !== "choose") {
        const seat = resolveSeats(state, effect.spec, ctx)[0];
        if (!seat) throw new Error("chooseTarget: spec resolved to no candidates");
        const nextCtx = { ...ctx, vars: { ...ctx.vars, boundTarget: { kind: "seat", seat } as BoundTarget } };
        return { state, newFrames: [{ effect: effect.then, ctx: nextCtx }] };
      }
      const candidates = candidatesFor(state, effect.spec.from, ctx);
      if (candidates.length === 0) throw new Error(`chooseTarget: no candidates for "${effect.spec.from}"`);
      if (candidates.length === 1) {
        const nextCtx = { ...ctx, vars: { ...ctx.vars, boundTarget: candidates[0]! } };
        return { state, newFrames: [{ effect: effect.then, ctx: nextCtx }] };
      }
      const chooserSeat = resolveSeats(state, effect.spec.chooser, ctx)[0];
      if (!chooserSeat) throw new Error("chooseTarget: chooser resolved to no seat");
      const [id, stateWithId] = nextPendingId(state);
      const pending: PendingInput = {
        id,
        seat: chooserSeat,
        prompt: { key: "chooseTarget" },
        minChoices: 1,
        maxChoices: 1,
        options: candidates.map((c, index) => ({
          id: String(index),
          label: c.kind === "seat" ? c.seat : `villainSlot:${c.index}`,
        })),
        resume: { kind: "chooseTarget", ctx, then: effect.then, candidates },
      };
      return { state: stateWithId, pending };
    }
  }
}

import type { CardCatalog } from "./catalog.ts";
import { drain } from "./drain.ts";
import { emit } from "./emit.ts";
import { advancePhase } from "./phase.ts";
import type { Action, Frame, GameState, ReduceResult, SeatId } from "./types.ts";

// docs/02's core contract is `reduce(state, action)`. Two more parameters
// turned out to be unavoidable once M2b needed them, both supplied by the
// caller (the Durable Object, in M4) rather than invented internally:
//  - `actingSeat`: which seat sent this action — reduce itself has no
//    notion of "who's asking" otherwise, but `respondToInput` must reject a
//    seat answering someone else's prompt.
//  - `catalog`: static card facts (cost/health) effect resolution needs —
//    see catalog.ts for why this can't just live in engine.
export type ReduceContext = { actingSeat: SeatId; catalog: CardCatalog };

// Removes one occurrence of `item`, not every occurrence — a zone can hold
// several copies of the same card id (e.g. 7x Alohomora), and playing or
// acquiring one must not remove all of them.
function removeOne<T>(items: T[], item: T): T[] {
  const index = items.indexOf(item);
  if (index === -1) return items;
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

export function reduce(state: GameState, action: Action, context: ReduceContext): ReduceResult {
  if (state.pending !== null && action.type !== "respondToInput") {
    return { ok: false, reason: "an input is pending; only respondToInput is accepted" };
  }

  switch (action.type) {
    case "advancePhase":
      return { ok: true, state: drain(advancePhase(state, context.catalog), context.catalog), events: [] };

    case "playCard": {
      const check = requireMainPhaseTurn(state, context);
      if (check) return check;
      const player = state.players[context.actingSeat]!;
      if (!player.hand.includes(action.cardId)) return { ok: false, reason: "card is not in hand" };

      // Tracked generically (not just for allies) so "for each X played this
      // turn" works for any card type once a card needs it — Bertie Botts
      // reads this back via {op:"gainAttack", amount:{expr:"count",
      // of:{counter:"played:ally"}}}.
      const type = context.catalog[action.cardId]?.type;
      const counters = type
        ? { ...state.counters, [`played:${type}`]: (state.counters[`played:${type}`] ?? 0) + 1 }
        : state.counters;

      const withCardMoved: GameState = {
        ...state,
        counters,
        players: {
          ...state.players,
          [context.actingSeat]: {
            ...player,
            hand: removeOne(player.hand, action.cardId),
            inPlay: [...player.inPlay, action.cardId],
          },
        },
      };

      const ownFrames: Frame[] = (context.catalog[action.cardId]?.effects ?? []).map((effect) => ({
        effect,
        ctx: { source: action.cardId, controller: context.actingSeat, vars: {} },
      }));
      const withOwnEffects: GameState = { ...withCardMoved, resolution: [...ownFrames, ...withCardMoved.resolution] };
      const triggered = emit(withOwnEffects, { type: "cardPlayed", cardId: action.cardId, seat: context.actingSeat }, context.catalog);
      return { ok: true, state: drain(triggered, context.catalog), events: [] };
    }

    case "acquireCard": {
      const check = requireMainPhaseTurn(state, context);
      if (check) return check;
      const index = state.market.row.indexOf(action.cardId);
      if (index === -1) return { ok: false, reason: "card is not in the market row" };

      const cost = context.catalog[action.cardId]?.cost ?? 0;
      const player = state.players[context.actingSeat]!;
      if (player.influence < cost) return { ok: false, reason: "not enough influence" };

      // Refilling the row is a consequence the engine performs, never
      // something the client asks for (docs/02 "Actions").
      const row = [...state.market.row];
      row[index] = null;
      let deck = state.market.deck;
      if (deck.length > 0) {
        const [refillId, ...rest] = deck;
        row[index] = refillId!;
        deck = rest;
      }

      const withCard: GameState = {
        ...state,
        market: { ...state.market, row, deck },
        players: {
          ...state.players,
          [context.actingSeat]: {
            ...player,
            influence: player.influence - cost,
            discard: [...player.discard, action.cardId],
          },
        },
      };
      const triggered = emit(withCard, { type: "cardAcquired", cardId: action.cardId, seat: context.actingSeat }, context.catalog);
      return { ok: true, state: drain(triggered, context.catalog), events: [] };
    }

    case "assignAttack": {
      const check = requireMainPhaseTurn(state, context);
      if (check) return check;
      if (action.amount <= 0) return { ok: false, reason: "amount must be positive" };
      const player = state.players[context.actingSeat]!;
      if (player.attack < action.amount) return { ok: false, reason: "not enough attack" };
      if (!state.villains.slots[action.villainSlot]) return { ok: false, reason: "villain slot is empty" };

      const withDeduction: GameState = {
        ...state,
        players: { ...state.players, [context.actingSeat]: { ...player, attack: player.attack - action.amount } },
        resolution: [
          {
            effect: { op: "assignDamageToVillain", villain: { who: "target" }, amount: action.amount },
            ctx: {
              source: "action:assignAttack",
              controller: context.actingSeat,
              vars: { boundTarget: { kind: "villainSlot", index: action.villainSlot } },
            },
          },
          ...state.resolution,
        ],
      };
      return { ok: true, state: drain(withDeduction, context.catalog), events: [] };
    }

    case "respondToInput": {
      const pending = state.pending;
      if (!pending) return { ok: false, reason: "no input is pending" };
      if (pending.id !== action.id) return { ok: false, reason: "pending input id mismatch" };
      if (pending.seat !== context.actingSeat) return { ok: false, reason: "wrong seat for this input" };
      if (action.choices.length < pending.minChoices || action.choices.length > pending.maxChoices) {
        return { ok: false, reason: "choice count out of range" };
      }

      const chosenIndex = Number(action.choices[0]);
      const resume = pending.resume;
      let nextFrame: Frame;
      if (resume.kind === "chooseOne") {
        const effect = resume.chosenEffects[chosenIndex];
        if (!effect) return { ok: false, reason: "invalid choice" };
        nextFrame = { effect, ctx: resume.ctx };
      } else {
        const candidate = resume.candidates[chosenIndex];
        if (!candidate) return { ok: false, reason: "invalid choice" };
        nextFrame = { effect: resume.then, ctx: { ...resume.ctx, vars: { ...resume.ctx.vars, boundTarget: candidate } } };
      }

      const resumed: GameState = { ...state, pending: null, resolution: [nextFrame, ...state.resolution] };
      return { ok: true, state: drain(resumed, context.catalog), events: [] };
    }

    default:
      return { ok: false, reason: `action "${action.type}" is not implemented yet` };
  }
}

// docs/02: "main is the only phase that accepts free-form player commands."
function requireMainPhaseTurn(state: GameState, context: ReduceContext): ReduceResult | null {
  if (context.actingSeat !== state.turn.activeSeat) return { ok: false, reason: "not your turn" };
  if (state.phase !== "main") return { ok: false, reason: "that action is only allowed during the main phase" };
  return null;
}

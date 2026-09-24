import type { CardId, EffectContext, GameState, ZoneRef } from "./types.ts";
import { resolveSeats } from "./target.ts";

// ponytail: only the zones a fixture actually needs are wired up (player
// deck/hand/discard/inPlay; market/darkArts deck+discard; villains
// deck+defeated; locations order). Market's `row` is `(CardId|null)[]`, a
// different shape, and isn't reachable through here yet — extend when a
// real card needs to move cards through it.
function isSharedOwner(
  owner: ZoneRef["owner"],
): owner is "market" | "darkArts" | "villains" | "locations" | "horcruxes" {
  return owner === "market" || owner === "darkArts" || owner === "villains" || owner === "locations" || owner === "horcruxes";
}

function resolveOneSeat(state: GameState, ref: ZoneRef, ctx: EffectContext): string {
  if (isSharedOwner(ref.owner)) throw new Error("resolveOneSeat: called with a shared owner");
  const seats = resolveSeats(state, ref.owner, ctx);
  if (seats.length !== 1) throw new Error("zones: a player zone ref must resolve to exactly one seat");
  return seats[0]!;
}

export function getZoneCards(state: GameState, ref: ZoneRef, ctx: EffectContext): CardId[] {
  if (isSharedOwner(ref.owner)) {
    if (ref.owner === "market" && ref.zone === "deck") return state.market.deck;
    if (ref.owner === "market" && ref.zone === "discard") return state.market.discard;
    if (ref.owner === "darkArts" && ref.zone === "deck") return state.darkArts.deck;
    if (ref.owner === "darkArts" && ref.zone === "discard") return state.darkArts.discard;
    if (ref.owner === "villains" && ref.zone === "deck") return state.villains.deck;
    if (ref.owner === "villains" && ref.zone === "defeated") return state.villains.defeated;
    if (ref.owner === "locations" && ref.zone === "order") return state.locations.order;
    throw new Error(`getZoneCards: unsupported zone "${ref.owner}.${ref.zone}"`);
  }

  const seat = resolveOneSeat(state, ref, ctx);
  const player = state.players[seat]!;
  switch (ref.zone) {
    case "deck":
      return player.deck;
    case "hand":
      return player.hand;
    case "discard":
      return player.discard;
    case "inPlay":
      return player.inPlay;
    default:
      throw new Error(`getZoneCards: unsupported player zone "${ref.zone}"`);
  }
}

export function setZoneCards(state: GameState, ref: ZoneRef, ctx: EffectContext, cards: CardId[]): GameState {
  if (isSharedOwner(ref.owner)) {
    if (ref.owner === "market" && ref.zone === "deck") return { ...state, market: { ...state.market, deck: cards } };
    if (ref.owner === "market" && ref.zone === "discard") {
      return { ...state, market: { ...state.market, discard: cards } };
    }
    if (ref.owner === "darkArts" && ref.zone === "deck") {
      return { ...state, darkArts: { ...state.darkArts, deck: cards } };
    }
    if (ref.owner === "darkArts" && ref.zone === "discard") {
      return { ...state, darkArts: { ...state.darkArts, discard: cards } };
    }
    if (ref.owner === "villains" && ref.zone === "deck") {
      return { ...state, villains: { ...state.villains, deck: cards } };
    }
    if (ref.owner === "villains" && ref.zone === "defeated") {
      return { ...state, villains: { ...state.villains, defeated: cards } };
    }
    if (ref.owner === "locations" && ref.zone === "order") {
      return { ...state, locations: { ...state.locations, order: cards } };
    }
    throw new Error(`setZoneCards: unsupported zone "${ref.owner}.${ref.zone}"`);
  }

  const seat = resolveOneSeat(state, ref, ctx);
  const player = state.players[seat]!;
  switch (ref.zone) {
    case "deck":
      return { ...state, players: { ...state.players, [seat]: { ...player, deck: cards } } };
    case "hand":
      return { ...state, players: { ...state.players, [seat]: { ...player, hand: cards } } };
    case "discard":
      return { ...state, players: { ...state.players, [seat]: { ...player, discard: cards } } };
    case "inPlay":
      return { ...state, players: { ...state.players, [seat]: { ...player, inPlay: cards } } };
    default:
      throw new Error(`setZoneCards: unsupported player zone "${ref.zone}"`);
  }
}

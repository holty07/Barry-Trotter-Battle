import type { CardId, ChoiceOption, GameState, HeroId, Phase, PromptSpec, SeatId, VillainInPlay, YearId } from "./types.ts";

// docs/04 "Redaction". What a seat is allowed to see, built as a whitelist:
// every field is copied in explicitly, so a field added to GameState later
// stays private until someone deliberately adds it here. Never included:
// `rng` (the seed predicts every future shuffle), deck contents (counts
// only), `resolution`, `modifiers`, `counters`, and a pending prompt's
// `resume` internals.

export type HandVisibility = "open" | "hidden";

export type PlayerSummaryView = {
  heroId: HeroId;
  heroLevel: 1 | 2 | 3;
  health: number;
  maxHealth: number;
  stunned: boolean;
  attack: number;
  influence: number;
  hand: CardId[] | null; // null when hidden from this viewer
  handCount: number;
  deckCount: number;
  discard: CardId[];
  inPlay: CardId[];
};

export type PendingView = {
  id: string;
  seat: SeatId;
  prompt: PromptSpec;
  minChoices: number;
  maxChoices: number;
  options: ChoiceOption[];
  source: CardId; // the card whose effect is asking
};

export type PlayerView = {
  you: SeatId | null;
  year: YearId;
  status: GameState["status"];
  phase: Phase;
  turn: { activeSeat: SeatId; number: number };
  seats: SeatId[];
  players: Record<SeatId, PlayerSummaryView>;
  market: { row: (CardId | null)[]; deckCount: number; discard: CardId[] };
  darkArts: { deckCount: number; discard: CardId[]; revealedThisTurn: CardId[] };
  villains: { slots: (VillainInPlay | null)[]; deckCount: number; defeated: CardId[] };
  locations: { order: CardId[]; current: number; controlTokens: number };
  pending: PendingView | null; // only for the seat that must answer
  waitingOn: SeatId | null; // everyone sees who the game is waiting on
};

export function viewFor(seat: SeatId | null, state: GameState, options: { hands: HandVisibility } = { hands: "open" }): PlayerView {
  const players: Record<SeatId, PlayerSummaryView> = {};
  for (const s of state.seats) {
    const p = state.players[s]!;
    const showHand = options.hands === "open" || s === seat;
    players[s] = {
      heroId: p.heroId,
      heroLevel: p.heroLevel,
      health: p.health,
      maxHealth: p.maxHealth,
      stunned: p.stunned,
      attack: p.attack,
      influence: p.influence,
      hand: showHand ? [...p.hand] : null,
      handCount: p.hand.length,
      deckCount: p.deck.length,
      discard: [...p.discard],
      inPlay: [...p.inPlay],
    };
  }

  const pending = state.pending;
  return {
    you: seat,
    year: state.year,
    status: state.status,
    phase: state.phase,
    turn: { activeSeat: state.turn.activeSeat, number: state.turn.number },
    seats: [...state.seats],
    players,
    market: { row: [...state.market.row], deckCount: state.market.deck.length, discard: [...state.market.discard] },
    darkArts: {
      deckCount: state.darkArts.deck.length,
      discard: [...state.darkArts.discard],
      revealedThisTurn: [...state.darkArts.revealedThisTurn],
    },
    villains: {
      slots: state.villains.slots.map((v) => (v ? { cardId: v.cardId, damageTaken: v.damageTaken } : null)),
      deckCount: state.villains.deck.length,
      defeated: [...state.villains.defeated],
    },
    locations: { order: [...state.locations.order], current: state.locations.current, controlTokens: state.locations.controlTokens },
    pending:
      pending && pending.seat === seat
        ? {
            id: pending.id,
            seat: pending.seat,
            prompt: { key: pending.prompt.key, ...(pending.prompt.vars ? { vars: { ...pending.prompt.vars } } : {}) },
            minChoices: pending.minChoices,
            maxChoices: pending.maxChoices,
            options: pending.options.map((o) => ({ id: o.id, label: o.label })),
            source: pending.resume.ctx.source,
          }
        : null,
    waitingOn: pending ? pending.seat : null,
  };
}

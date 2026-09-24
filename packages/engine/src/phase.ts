import type { CardCatalog } from "./catalog.ts";
import { shuffle } from "./rng.ts";
import type { CardId, Frame, GameState, Phase } from "./types.ts";

// docs/02 "Turn structure".
const PHASE_ORDER: Phase[] = ["turnStart", "darkArts", "villainAbilities", "main", "discardAndDraw", "turnEnd"];

// docs/06 M2c: the active location's own card says how many Dark Arts to
// reveal each turn (see LocationCard.darkArtsPerTurn) — not a fixed number.
// Last turn's revealed cards go to discard before revealing new ones.
function revealDarkArts(state: GameState, catalog: CardCatalog): GameState {
  const locationId = state.locations.order[state.locations.current];
  const count = locationId ? (catalog[locationId]?.darkArtsPerTurn ?? 0) : 0;

  let discard = [...state.darkArts.discard, ...state.darkArts.revealedThisTurn];
  let deck = [...state.darkArts.deck];
  let rng = state.rng;
  const revealed: CardId[] = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const [shuffled, nextRng] = shuffle(discard, rng);
      rng = nextRng;
      deck = shuffled;
      discard = [];
    }
    revealed.push(deck.shift()!);
  }

  const newFrames: Frame[] = revealed.flatMap((cardId) =>
    (catalog[cardId]?.effects ?? []).map((effect) => ({
      effect,
      ctx: { source: cardId, controller: state.turn.activeSeat, vars: {} },
    })),
  );

  return {
    ...state,
    rng,
    darkArts: { deck, discard, revealedThisTurn: revealed },
    resolution: [...newFrames, ...state.resolution],
  };
}

export function advancePhase(state: GameState, catalog: CardCatalog): GameState {
  const currentIndex = PHASE_ORDER.indexOf(state.phase);
  const nextPhase = PHASE_ORDER[currentIndex + 1];

  if (nextPhase) {
    const advanced = { ...state, phase: nextPhase };
    return nextPhase === "darkArts" ? revealDarkArts(advanced, catalog) : advanced;
  }

  // turnEnd -> next seat's turnStart: docs/02 "Resource reset" invariant —
  // the finishing player's attack/influence go to 0 and per-turn counters
  // clear. Stunning (confirmed by the project owner): a stunned player
  // heals to full and stops being stunned at the end of their own turn —
  // not at the start of their next one.
  const finishingSeat = state.turn.activeSeat;
  const finishingPlayer = state.players[finishingSeat];
  if (!finishingPlayer) throw new Error(`advancePhase: unknown active seat "${finishingSeat}"`);

  const seatIndex = state.seats.indexOf(finishingSeat);
  const nextSeat = state.seats[(seatIndex + 1) % state.seats.length];
  if (!nextSeat) throw new Error("advancePhase: no seats to advance to");

  const updatedFinishing = finishingPlayer.stunned
    ? { ...finishingPlayer, attack: 0, influence: 0, stunned: false, health: finishingPlayer.maxHealth }
    : { ...finishingPlayer, attack: 0, influence: 0 };

  return {
    ...state,
    phase: "turnStart",
    turn: { activeSeat: nextSeat, number: state.turn.number + 1 },
    players: { ...state.players, [finishingSeat]: updatedFinishing },
    counters: {},
  };
}

import type { CardCatalog } from "./catalog.ts";
import { shuffle } from "./rng.ts";
import type { CardId, GameState, HeroId, Modifier, Rng, SeatId, VillainInPlay } from "./types.ts";

// Hand size of 5 comes from the transcribed Turn Order card ("...draw five
// new cards" — content/cards/proficiencies.json, Y0), not a guess: the
// same number is used for the opening hand and every end-of-turn draw
// (phase.ts's discardAndDraw).
export const HAND_SIZE = 5;

export type SetupInput = {
  seed: number;
  year: GameState["year"];
  seats: SeatId[];
  heroesBySeat: Record<SeatId, { heroId: HeroId; heroLevel: 1 | 2 | 3; startingDeck: CardId[] }>;
  villainSlotCount: number;
  marketRowSize: number;
  startingHealth: number;
  market: CardId[];
  villains: CardId[];
  darkArts: CardId[];
  locations: CardId[];
};

// A villain's `ability` (docs/03 "while active" triggers) becomes real
// modifiers the moment it enters a slot — see docs/06 M2c "wire villains
// ... through modifiers rather than bespoke systems".
export function villainAbilityModifiers(cardId: CardId, catalog: CardCatalog, idPrefix: string): Modifier[] {
  const ability = catalog[cardId]?.ability ?? [];
  return ability.map((modifier, index) => ({
    ...modifier,
    id: `${idPrefix}-${index}`,
    source: { kind: "villain", id: cardId },
  }));
}

/**
 * Builds a fresh, valid `GameState` for the given year/seats/seed. Takes
 * fully-resolved card id lists rather than raw content — resolving a
 * scenario's card ids (and each hero's starting deck) into these lists is
 * `packages/content`'s job, not engine's (engine may not import content —
 * docs/01 "Repository boundaries"). `catalog` supplies the static facts
 * (villain ability/health, etc.) resolution needs — see catalog.ts.
 */
export function setup(input: SetupInput, catalog: CardCatalog): GameState {
  let rng: Rng = { seed: input.seed, cursor: 0 };

  const players: GameState["players"] = {};
  for (const seat of input.seats) {
    const hero = input.heroesBySeat[seat];
    if (!hero) throw new Error(`setup: no hero assigned for seat "${seat}"`);

    const [deck, nextRng] = shuffle(hero.startingDeck, rng);
    rng = nextRng;
    players[seat] = {
      heroId: hero.heroId,
      heroLevel: hero.heroLevel,
      deck: deck.slice(HAND_SIZE),
      hand: deck.slice(0, HAND_SIZE),
      discard: [],
      inPlay: [],
      health: input.startingHealth,
      maxHealth: input.startingHealth,
      stunned: false,
      attack: 0,
      influence: 0,
      tokens: {},
    };
  }

  const [marketDeck, rngAfterMarket] = shuffle(input.market, rng);
  rng = rngAfterMarket;
  const row = marketDeck.slice(0, input.marketRowSize);
  const remainingMarket = marketDeck.slice(input.marketRowSize);

  const [villainDeck, rngAfterVillains] = shuffle(input.villains, rng);
  rng = rngAfterVillains;
  const placedVillains = villainDeck.slice(0, input.villainSlotCount);
  const slots: (VillainInPlay | null)[] = placedVillains.map((cardId) => ({ cardId, damageTaken: 0 }));
  while (slots.length < input.villainSlotCount) slots.push(null);
  const remainingVillains = villainDeck.slice(input.villainSlotCount);

  const modifiers = placedVillains.flatMap((cardId, index) =>
    villainAbilityModifiers(cardId, catalog, `setup-villain-${index}`),
  );

  const [darkArtsDeck, rngAfterDarkArts] = shuffle(input.darkArts, rng);
  rng = rngAfterDarkArts;

  const firstSeat = input.seats[0];
  if (!firstSeat) throw new Error("setup: at least one seat is required");

  return {
    schema: 1,
    rng,
    year: input.year,
    status: "playing",
    phase: "turnStart",
    turn: { activeSeat: firstSeat, number: 1 },
    seats: input.seats,
    players,
    market: { deck: remainingMarket, row, discard: [] },
    darkArts: { deck: darkArtsDeck, discard: [], revealedThisTurn: [] },
    villains: { deck: remainingVillains, slots, defeated: [] },
    locations: { order: input.locations, current: 0, controlTokens: 0 },
    resolution: [],
    pending: null,
    modifiers,
    counters: {},
    log: [],
  };
}

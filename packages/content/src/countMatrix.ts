import type { CardType } from "./schema/card.ts";

// docs/03-content-schema.md "The validation target" — the community
// physical-inventory count matrix, transcribed verbatim. `–` cells become
// 0 (that type doesn't appear that year). Keyed by year 0-7 to match
// `introducedIn`; year 0 is the evergreen starter pool (see the YearId note
// in schema/common.ts).
//
// The Y0 "Proficiency" row (4 cards) is the turn-order cards, which occupy
// the same board slot as real Proficiencies but aren't proficiency cards
// mechanically — docs/03 says to "model them separately from real
// Proficiencies". They're still typed `proficiency` / `introducedIn: 0`
// here because that's the matrix cell being checked against; keep a `notes`
// entry on those four cards when you transcribe them.
export const COUNT_MATRIX: Record<CardType, Record<number, number>> = {
  location: { 0: 0, 1: 2, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 4 },
  darkArts: { 0: 0, 1: 10, 2: 5, 3: 4, 4: 8, 5: 7, 6: 3, 7: 4 },
  villain: { 0: 0, 1: 3, 2: 3, 3: 2, 4: 2, 5: 3, 6: 3, 7: 1 },
  spell: { 0: 28, 1: 17, 2: 4, 3: 4, 4: 5, 5: 2, 6: 2, 7: 0 },
  item: { 0: 8, 1: 10, 2: 4, 3: 9, 4: 8, 5: 2, 6: 7, 7: 1 },
  ally: { 0: 4, 1: 3, 2: 6, 3: 3, 4: 8, 5: 6, 6: 1, 7: 0 },
  hero: { 0: 0, 1: 4, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0, 7: 4 },
  proficiency: { 0: 4, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 9, 7: 0 },
  horcrux: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 6 },
};

export const CARD_TYPES_IN_MATRIX = Object.keys(COUNT_MATRIX) as CardType[];
export const MATRIX_YEARS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function expectedCount(type: CardType, year: number): number {
  return COUNT_MATRIX[type]?.[year] ?? 0;
}

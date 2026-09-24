import { z } from "zod";
import { cardIdSchema } from "./common.ts";

// A scenario is a playable box (Years 1-7 only — Y0 in the count matrix is
// the evergreen starter pool, not a scenario; see the note in common.ts).
export const scenarioYearIdSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
export type ScenarioYearId = z.infer<typeof scenarioYearIdSchema>;

export const seatCountSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);
export type SeatCount = z.infer<typeof seatCountSchema>;

// docs/03: "Player-count-dependent numbers go here as either a scalar or
// { "2": x, "3": y, "4": z }. The loader normalises."
export function playerCountValueSchema<T extends z.ZodTypeAny>(value: T) {
  return z.union([value, z.object({ "2": value, "3": value, "4": value })]);
}
export type PlayerCountValue<T> = T | { "2": T; "3": T; "4": T };

export const yearFlagsSchema = z
  .object({
    usesDice: z.boolean(),
    usesProficiencies: z.boolean(),
    usesHorcruxes: z.boolean(),
  })
  .catchall(z.boolean());
export type YearFlags = z.infer<typeof yearFlagsSchema>;

// docs/03 "Year scenario file" — `darkArtsPerTurn` is deliberately absent:
// per the project owner, it isn't a per-year constant, the active
// location's own card tells you how many Dark Arts to reveal each turn
// (see `darkArtsPerTurn` on LocationCard in ./card.ts instead).
export const yearScenarioSchema = z.object({
  year: scenarioYearIdSchema,
  villainSlots: playerCountValueSchema(z.number().int().positive()),
  marketRowSize: playerCountValueSchema(z.number().int().positive()),
  startingHealth: playerCountValueSchema(z.number().int().positive()),
  locations: z.array(cardIdSchema),
  villains: z.array(cardIdSchema),
  darkArts: z.array(cardIdSchema),
  market: z.array(cardIdSchema),
  heroLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  flags: yearFlagsSchema,
  rulesDeltas: z.array(z.string()),
});
export type YearScenario = z.infer<typeof yearScenarioSchema>;

// All card-id-array fields on a scenario, and the type they must resolve
// to — used by the loader and by content:check's reference check.
export const SCENARIO_CARD_LIST_FIELDS = ["locations", "villains", "darkArts", "market"] as const;

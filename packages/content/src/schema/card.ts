import { z } from "zod";
import { cardIdSchema, cardTypeSchema, effectSchema, villainAbilitySchema, yearIdSchema } from "./common.ts";

export { cardTypeSchema };
export type { CardType } from "./common.ts";

// docs/03-content-schema.md "Schema" — CardBase plus the per-type variants.
// `text` and `effects` are both required: `text` is what's printed (display
// only, never parsed), `effects` is what actually happens.
const cardBaseFields = {
  id: cardIdSchema,
  name: z.string().min(1),
  introducedIn: yearIdSchema,
  copies: z.number().int().positive(),
  text: z.string().min(1),
  effects: z.array(effectSchema),
  notes: z.string().optional(),
};

export const marketCardSchema = z.object({
  ...cardBaseFields,
  type: z.enum(["spell", "item", "ally"]),
  cost: z.number().int().nonnegative(),
  // Which hero's starting deck this card belongs to (each hero's starter spells,
  // signature items and familiar in the Y0 evergreen pool) — absent for
  // ordinary market cards. Value matches HeroCard.hero. Needed to resolve
  // each hero's starting deck; docs/03 names no other mechanism for it.
  hero: z.string().min(1).optional(),
});
export type MarketCard = z.infer<typeof marketCardSchema>;

export const villainCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("villain"),
  health: z.number().int().positive(),
  ability: z.array(villainAbilitySchema).optional(),
  reward: z.array(effectSchema),
});
export type VillainCard = z.infer<typeof villainCardSchema>;

export const darkArtsCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("darkArts"),
});
export type DarkArtsCard = z.infer<typeof darkArtsCardSchema>;

export const locationCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("location"),
  controlSlots: z.number().int().positive(),
  // How many Dark Arts cards to reveal each turn while this location is
  // active — a fact of the location itself, not a per-year scenario
  // constant (confirmed by the project owner).
  darkArtsPerTurn: z.number().int().nonnegative(),
});
export type LocationCard = z.infer<typeof locationCardSchema>;

export const heroCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("hero"),
  hero: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type HeroCard = z.infer<typeof heroCardSchema>;

// docs/03's directory listing and count matrix both name "proficiency" and
// "horcrux" card types (content/cards/proficiencies.json,
// content/cards/horcruxes.json), but the "Schema" section never gives them
// their own type definition the way Market/Villain/DarkArts/Location/Hero
// get one. TODO(rules): confirmed as a plain CardBase extension for now —
// flag if a Year 6/7 transcription needs fields this doesn't have.
export const proficiencyCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("proficiency"),
});
export type ProficiencyCard = z.infer<typeof proficiencyCardSchema>;

export const horcruxCardSchema = z.object({
  ...cardBaseFields,
  type: z.literal("horcrux"),
});
export type HorcruxCard = z.infer<typeof horcruxCardSchema>;

export const cardSchema = z.discriminatedUnion("type", [
  marketCardSchema,
  villainCardSchema,
  darkArtsCardSchema,
  locationCardSchema,
  heroCardSchema,
  proficiencyCardSchema,
  horcruxCardSchema,
]);
export type Card = z.infer<typeof cardSchema>;

// Which content/cards/*.json file each card type is expected to live in —
// used by both the loader and content:check.
export const CARD_FILES_BY_TYPE: Record<z.infer<typeof cardTypeSchema>, string> = {
  spell: "spells.json",
  item: "items.json",
  ally: "allies.json",
  villain: "villains.json",
  darkArts: "darkarts.json",
  location: "locations.json",
  hero: "heroes.json",
  proficiency: "proficiencies.json",
  horcrux: "horcruxes.json",
};

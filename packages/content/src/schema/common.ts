import { z } from "zod";
import type {
  Amount,
  CardFilter,
  CardSelector,
  CountableRef,
  DieId,
  Effect,
  Modifier,
  Predicate,
  TargetSpec,
  ZoneOwner,
  ZoneRef,
} from "@hb/engine";
import { EFFECT_OPS } from "@hb/engine";

// Runtime zod validators for @hb/engine's types — engine owns the
// canonical shapes (docs/01 "packages/content may import engine types");
// this file is just the schema wrapped around them for content loading.
export { EFFECT_OPS };

// Card ids: <type>.<slug> — see docs/03-content-schema.md "Card ID convention".
export const cardIdSchema = z
  .string()
  .regex(/^[a-z]+(-[a-z]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/, "expected <type>.<slug>, e.g. spell.test-a");
export type CardId = z.infer<typeof cardIdSchema>;

export const cardTypeSchema = z.enum([
  "spell",
  "item",
  "ally",
  "villain",
  "darkArts",
  "location",
  "hero",
  "proficiency",
  "horcrux",
]);
export type CardType = z.infer<typeof cardTypeSchema>;

// docs/02-engine-spec.md types `YearId` as 1..7. docs/03's count matrix has a
// "Y0" column for the evergreen starter cards (base spells/items/allies and
// the four turn-order cards) that ship in every game regardless of which
// year box is played. TODO(rules): reconcile — either YearId grows a 0
// member in the engine too, or Y0 cards need a different metadata field
// entirely. Confirmed with the project owner before building M2 setup().
export const yearIdSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
export type YearId = z.infer<typeof yearIdSchema>;

// A machine-readable key, never a display string — see docs/02 "Two rules
// about this vocabulary".
export const labelKeySchema = z.string().min(1);

export const targetSpecSchema: z.ZodType<TargetSpec> = z.lazy(() =>
  z.discriminatedUnion("who", [
    z.object({ who: z.literal("controller") }),
    z.object({ who: z.literal("activePlayer") }),
    z.object({ who: z.literal("allHeroes") }),
    z.object({ who: z.literal("target") }),
    z.object({ who: z.literal("eventSeat") }),
    z.object({
      who: z.literal("choose"),
      from: z.enum(["anyHero", "otherHeroes", "activeVillains"]),
      chooser: targetSpecSchema,
    }),
    z.object({ who: z.literal("each"), from: z.literal("heroes") }),
  ]),
);

export const zoneOwnerSchema: z.ZodType<ZoneOwner> = z.union([
  targetSpecSchema,
  z.enum(["market", "darkArts", "villains", "locations", "horcruxes"]),
]);

export const zoneRefSchema: z.ZodType<ZoneRef> = z.object({
  owner: zoneOwnerSchema,
  zone: z.string().min(1),
});

export const cardFilterSchema: z.ZodType<CardFilter> = z.object({
  types: z.array(cardTypeSchema).optional(),
  maxCost: z.number().int().nonnegative().optional(),
});

export const cardSelectorSchema: z.ZodType<CardSelector> = z.object({
  zone: zoneRefSchema.optional(),
  types: z.array(cardTypeSchema).optional(),
  matchAll: z.boolean().optional(),
  fromEvent: z.boolean().optional(),
});

export const countableRefSchema: z.ZodType<CountableRef> = z.union([
  z.object({ matching: cardSelectorSchema }),
  z.object({ counter: z.string().min(1) }),
]);

export const amountSchema: z.ZodType<Amount> = z.union([
  z.number(),
  z.object({ expr: z.literal("count"), of: countableRefSchema }),
]);

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }),
    z.object({ kind: z.literal("not"), of: predicateSchema }),
    z.object({ kind: z.literal("and"), of: z.array(predicateSchema) }),
    z.object({ kind: z.literal("or"), of: z.array(predicateSchema) }),
    z.object({ kind: z.literal("countAtLeast"), ref: countableRefSchema, amount: z.number() }),
    z.object({ kind: z.literal("cardTypeIs"), ref: z.enum(["eventCard", "eventSource"]), cardType: z.string().min(1) }),
    z.object({ kind: z.literal("eventCardIsSource") }),
  ]),
);

export const dieIdSchema: z.ZodType<DieId> = z.string().min(1);

export const effectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("gainAttack"), amount: amountSchema, target: targetSpecSchema.optional() }),
    z.object({ op: z.literal("gainInfluence"), amount: amountSchema, target: targetSpecSchema.optional() }),
    z.object({ op: z.literal("heal"), amount: amountSchema, target: targetSpecSchema }),
    z.object({ op: z.literal("damage"), amount: amountSchema, target: targetSpecSchema }),
    z.object({ op: z.literal("draw"), count: amountSchema, target: targetSpecSchema.optional() }),
    z.object({
      op: z.literal("discard"),
      count: amountSchema,
      target: targetSpecSchema,
      chooser: z.enum(["target", "controller"]),
    }),
    z.object({ op: z.literal("moveCard"), from: zoneRefSchema, to: zoneRefSchema, select: cardSelectorSchema }),
    z.object({ op: z.literal("revealTop"), zone: zoneRefSchema, count: z.number().int().positive(), then: effectSchema }),
    z.object({ op: z.literal("acquireFree"), filter: cardFilterSchema, maxCost: z.number().int().nonnegative().optional() }),
    z.object({ op: z.literal("addControl"), amount: amountSchema }),
    z.object({ op: z.literal("removeControl"), amount: amountSchema }),
    z.object({ op: z.literal("assignDamageToVillain"), villain: targetSpecSchema, amount: amountSchema }),
    z.object({ op: z.literal("stun"), target: targetSpecSchema }),
    z.object({ op: z.literal("rollDie"), die: dieIdSchema, then: effectSchema }),
    z.object({ op: z.literal("sequence"), effects: z.array(effectSchema) }),
    z.object({
      op: z.literal("chooseOne"),
      options: z.array(z.object({ label: labelKeySchema, effect: effectSchema })).min(1),
      chooser: targetSpecSchema,
    }),
    z.object({ op: z.literal("chooseTarget"), spec: targetSpecSchema, then: effectSchema }),
    z.object({ op: z.literal("forEach"), over: z.union([targetSpecSchema, cardSelectorSchema]), effect: effectSchema }),
    z.object({ op: z.literal("ifThen"), cond: predicateSchema, then: effectSchema, else: effectSchema.optional() }),
    z.object({ op: z.literal("repeat"), times: amountSchema, effect: effectSchema }),
    z.object({ op: z.literal("addModifier"), modifier: addModifierEffectSchema }),
    z.object({ op: z.literal("adjustCounter"), key: z.string().min(1), amount: amountSchema }),
    z.object({ op: z.literal("noop") }),
  ]),
);

// docs/02 "Triggers and lasting effects". `on` (GameEventType) and
// `source.kind` names aren't exhaustively listed in docs/02 beyond
// examples, so `on` stays an open string rather than a guessed closed enum.
export const modifierSourceSchema = z.object({
  kind: z.enum(["card", "location", "villain", "horcrux", "proficiency"]),
  id: cardIdSchema,
});

// Fields every modifier needs regardless of where `id`/`source` come from.
function modifierCoreFields() {
  return {
    on: z.string().min(1),
    condition: predicateSchema.optional(),
    effect: effectSchema,
    duration: z.enum(["thisTurn", "thisRound", "whileSourceActive", "permanent"]),
    limitPerTurn: z.number().int().positive().optional(),
    usesThisTurn: z.number().int().nonnegative().optional(),
  };
}

function modifierWithoutIdSchema() {
  return z.object({ source: modifierSourceSchema, ...modifierCoreFields() });
}

export const modifierSchema: z.ZodType<Modifier> = z.object({
  id: z.string().min(1),
  ...modifierWithoutIdSchema().shape,
});

// `addModifier`'s inline modifier (docs/02): `source` is optional here,
// unlike `modifierSchema` — a card registering its own reactive modifier
// doesn't restate its own id; it defaults to
// whichever card's effect is currently resolving (engine's resolve.ts).
export const addModifierEffectSchema = z.object({ source: modifierSourceSchema.optional(), ...modifierCoreFields() });

// A villain's `ability` array (docs/03): source and id are both assigned
// when the ability is registered as a real modifier on entering a slot
// (packages/engine's setup.ts `villainAbilityModifiers`), so content never
// authors either.
export const villainAbilitySchema = z.object(modifierCoreFields());

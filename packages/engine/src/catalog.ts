import type { CardId, Effect, Modifier } from "./types.ts";

// Static per-card facts effect resolution needs (cost for `acquireFree`,
// health for villain-defeat detection, control slots for the location loss
// check, a villain's ability/reward, a location's Dark Arts count). Engine
// may not import content (docs/01 "Repository boundaries"), so the caller
// resolves these from content and passes them in — see docs/02 "the engine
// can't depend on specific cards if it has never seen them".
export type CardCatalog = Record<
  CardId,
  {
    cost?: number;
    health?: number;
    controlSlots?: number;
    darkArtsPerTurn?: number;
    // `id`/`source` are assigned when the ability is registered as a real
    // modifier (setup.ts's `villainAbilityModifiers`) — content-authored
    // abilities don't supply either.
    ability?: Omit<Modifier, "id" | "source">[];
    reward?: Effect[];
    effects?: Effect[];
  }
>;

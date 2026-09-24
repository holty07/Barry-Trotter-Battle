import type { CardCatalog } from "./catalog.ts";
import { evaluatePredicate } from "./resolve.ts";
import type { EffectContext, Frame, GameEvent, GameState, Modifier } from "./types.ts";

// docs/02 "Triggers and lasting effects": modifiers matching an event fire
// in a fixed order — active villains first, then locations, then the
// active player's cards, then other players' cards, then permanents.
// docs/02 names these five buckets but doesn't say where horcrux/
// proficiency modifiers or an ownerless card modifier land — TODO(spec):
// treated as "permanents" (bucket 4) since nothing else fits.
function bucketFor(state: GameState, modifier: Modifier): number {
  if (modifier.source.kind === "villain") return 0;
  if (modifier.source.kind === "location") return 1;
  if (modifier.controller === state.turn.activeSeat) return 2;
  if (modifier.controller !== undefined) return 3;
  return 4;
}

/**
 * Walks `state.modifiers` for ones matching `event.type` whose `condition`
 * (if any) holds, and pushes their effects onto the resolution stack in
 * trigger order. Does not drain — the caller drains after emitting.
 */
export function emit(state: GameState, event: GameEvent, catalog: CardCatalog = {}): GameState {
  const matching = state.modifiers.filter((modifier) => modifier.on === event.type);

  const contextFor = (modifier: Modifier): EffectContext => ({
    source: modifier.source.id,
    controller: modifier.controller ?? state.turn.activeSeat,
    vars: { event },
  });

  const triggered = matching.filter(
    (modifier) => !modifier.condition || evaluatePredicate(state, modifier.condition, contextFor(modifier), catalog),
  );

  // Array.prototype.sort is stable (ES2019+), so modifiers within the same
  // bucket keep their `state.modifiers` insertion order — a deterministic,
  // if arbitrary, tiebreaker docs/02 doesn't specify.
  const ordered = [...triggered].sort((a, b) => bucketFor(state, a) - bucketFor(state, b));

  const newFrames: Frame[] = ordered.map((modifier) => ({ effect: modifier.effect, ctx: contextFor(modifier) }));

  return { ...state, resolution: [...newFrames, ...state.resolution] };
}

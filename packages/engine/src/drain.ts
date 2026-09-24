import type { CardCatalog } from "./catalog.ts";
import { applyEffect } from "./resolve.ts";
import type { GameState } from "./types.ts";

// docs/02 "Termination": drain cannot loop forever. A real trigger loop is
// possible once M2c wires modifiers — cap iterations and fail loudly.
export const MAX_DRAIN_ITERATIONS = 10_000;

/**
 * Pops frames off `state.resolution` and applies them until the stack is
 * empty (state is stable) or an effect sets `pending` (state is blocked).
 * docs/02 invariant: never returns with both `resolution` non-empty and
 * `pending` null.
 */
export function drain(state: GameState, catalog: CardCatalog): GameState {
  let current = state;
  let iterations = 0;

  while (current.resolution.length > 0) {
    iterations++;
    if (iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(`drain: exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely an infinite trigger loop`);
    }

    const [frame, ...rest] = current.resolution;
    const result = applyEffect({ ...current, resolution: rest }, frame!, catalog);

    if (result.pending) {
      current = { ...result.state, pending: result.pending };
      return current;
    }

    current = { ...result.state, resolution: [...(result.newFrames ?? []), ...result.state.resolution] };
  }

  return current;
}

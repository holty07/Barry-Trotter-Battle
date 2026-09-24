import type { BoundTarget, EffectContext, GameState, SeatId, TargetSpec } from "./types.ts";

// Resolves a TargetSpec to concrete seats. `{who:"choose", ...}` is
// deliberately unsupported here — ponytail: single simplification, every
// choice-driven target goes through an explicit `chooseTarget` first (which
// binds `ctx.vars.boundTarget`), so every other op only ever sees specs that
// are already resolvable without asking anyone anything. Extend this if a
// real card needs an inline choice outside `chooseTarget`.
export function resolveSeats(state: GameState, spec: TargetSpec, ctx: EffectContext): SeatId[] {
  switch (spec.who) {
    case "controller":
      return [ctx.controller];
    case "activePlayer":
      return [state.turn.activeSeat];
    case "allHeroes":
    case "each":
      return [...state.seats];
    case "target": {
      const bound = ctx.vars["boundTarget"] as BoundTarget | undefined;
      if (!bound) {
        throw new Error('resolveSeats: {who:"target"} used with no bound target — use chooseTarget first');
      }
      if (bound.kind !== "seat") {
        throw new Error(`resolveSeats: bound target is a ${bound.kind}, not a seat`);
      }
      return [bound.seat];
    }
    case "choose":
      throw new Error(
        'resolveSeats: inline {who:"choose"} is not supported outside chooseTarget — wrap the effect in chooseTarget first',
      );
  }
}

// Candidates for a chooseTarget "from" clause. Villains are slot indices,
// not seats — see the BoundTarget note in types.ts.
export function candidatesFor(
  state: GameState,
  from: "anyHero" | "otherHeroes" | "activeVillains",
  ctx: EffectContext,
): BoundTarget[] {
  if (from === "anyHero") return state.seats.map((seat) => ({ kind: "seat", seat }));
  if (from === "otherHeroes") {
    return state.seats.filter((seat) => seat !== ctx.controller).map((seat) => ({ kind: "seat", seat }));
  }
  const withNulls: (BoundTarget | null)[] = state.villains.slots.map((slot, index) =>
    slot ? { kind: "villainSlot", index } : null,
  );
  return withNulls.filter((candidate): candidate is BoundTarget => candidate !== null);
}

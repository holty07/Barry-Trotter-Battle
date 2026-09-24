import type { CardId, GameState } from "../types.ts";

// docs/02 "Invariants to test as properties" — card conservation: the total
// count of every card id across all zones never changes. Reusable across
// setup/phase/effect tests so it's asserted the same way everywhere.
export function countCards(state: GameState): Map<CardId, number> {
  const counts = new Map<CardId, number>();
  const add = (id: CardId | null | undefined) => {
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };

  for (const player of Object.values(state.players)) {
    for (const zone of [player.deck, player.hand, player.discard, player.inPlay]) {
      for (const id of zone) add(id);
    }
  }
  for (const id of state.market.deck) add(id);
  for (const id of state.market.row) add(id);
  for (const id of state.market.discard) add(id);
  for (const id of state.darkArts.deck) add(id);
  for (const id of state.darkArts.discard) add(id);
  for (const id of state.darkArts.revealedThisTurn) add(id);
  for (const id of state.villains.deck) add(id);
  for (const slot of state.villains.slots) add(slot?.cardId);
  for (const id of state.villains.defeated) add(id);
  for (const id of state.locations.order) add(id);
  if (state.horcruxes) {
    for (const id of state.horcruxes.deck) add(id);
    add(state.horcruxes.active);
    for (const id of state.horcruxes.destroyed) add(id);
  }
  if (state.proficiency) {
    for (const id of Object.values(state.proficiency)) add(id);
  }

  return counts;
}

export function assertCardsConserved(before: Map<CardId, number>, after: GameState): void {
  const afterCounts = countCards(after);
  const ids = new Set([...before.keys(), ...afterCounts.keys()]);
  const mismatches: string[] = [];
  for (const id of ids) {
    const b = before.get(id) ?? 0;
    const a = afterCounts.get(id) ?? 0;
    if (a !== b) mismatches.push(`${id}: was ${b}, now ${a}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`card conservation violated:\n  ${mismatches.join("\n  ")}`);
  }
}

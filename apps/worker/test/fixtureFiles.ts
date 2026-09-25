import type { RawContentFiles } from "@hb/content/browser";

// Stands in for src/contentFiles.ts under test (vitest.config.ts alias), so
// the room runs against the synthetic fixtures — content/ is never in CI.
// The shared fixtures have one hero and no starting decks, and a room game
// needs two seated heroes, so two made-up starter decks are added here.
const cards = import.meta.glob("../../../packages/content/fixtures/cards/*.json", { eager: true, import: "default" });
const years = import.meta.glob("../../../packages/content/fixtures/years/*.json", { eager: true, import: "default" });

const byFileName = (files: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(files).map(([path, json]) => [path.slice(path.lastIndexOf("/") + 1), json]));

const starter = (hero: string, suffix: string, copies: number, effects: unknown[]) => ({
  id: `spell.test-starter-${hero}-${suffix}`,
  name: `Test Starter ${suffix}`,
  type: "spell",
  introducedIn: 0,
  copies,
  cost: 0,
  hero,
  text: "Fixture starter card.",
  effects,
});

const cardFiles = byFileName(cards);
cardFiles["heroes.json"] = [
  ...(cardFiles["heroes.json"] as unknown[]),
  { id: "hero.test-hero-b", name: "Test Hero B", type: "hero", introducedIn: 1, copies: 1, hero: "test-hero-b", level: 1, text: "Fixture hero.", effects: [] },
];
cardFiles["spells.json"] = [
  ...(cardFiles["spells.json"] as unknown[]),
  ...["test-hero-a", "test-hero-b"].flatMap((hero) => [
    starter(hero, "attack", 3, [{ op: "gainAttack", amount: 1 }]),
    starter(hero, "influence", 7, [{ op: "gainInfluence", amount: 1 }]),
  ]),
];

export const contentFiles: RawContentFiles = { cards: cardFiles, years: byFileName(years) };

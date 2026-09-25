import type { CardCatalog, CardId } from "@hb/engine";
import { buildCardCatalog, parseContentSet, type ContentIssue, type ContentSet, type ScenarioYearId } from "@hb/content/browser";
import type { CardFace, CardKind } from "../table/model.ts";

// content/ is git-ignored and bundled at build time (project owner's call):
// Vite inlines whatever JSON is on disk when the client is built or served.
// With no content/ present these are empty and the Home screen says so.
const cardFiles = import.meta.glob("../../../../content/cards/*.json", { eager: true, import: "default" });
const yearFiles = import.meta.glob("../../../../content/years/*.json", { eager: true, import: "default" });

const byFileName = (files: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(files).map(([path, json]) => [path.slice(path.lastIndexOf("/") + 1), json]));

export type HeroOption = { heroId: string; name: string };

export type ContentBundle = {
  content: ContentSet;
  catalog: CardCatalog;
  faces: Record<CardId, CardFace>;
  years: ScenarioYearId[];
  heroName: (heroId: string) => string;
  heroesFor: (year: ScenarioYearId) => HeroOption[];
};

const FACE_KINDS = new Set<string>(["spell", "item", "ally", "villain", "darkArts", "location"]);

// Display only: the printed hero card names carry a "(Year N)" suffix that
// the table doesn't need on every ribbon and turn banner.
const shortHeroName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

export function buildBundle(content: ContentSet): ContentBundle {
  const heroCards = [...content.cards.values()].filter((c) => c.type === "hero");
  const heroName = (heroId: string) => {
    const card = heroCards.find((c) => c.hero === heroId);
    return card ? shortHeroName(card.name) : heroId;
  };

  const faces: Record<CardId, CardFace> = {};
  for (const card of content.cards.values()) {
    if (!FACE_KINDS.has(card.type)) continue;
    faces[card.id] = {
      id: card.id,
      name: card.name,
      text: card.text,
      kind: card.type as CardKind,
      ...("cost" in card ? { cost: card.cost } : {}),
      ...("health" in card ? { health: card.health } : {}),
      year: card.introducedIn,
      ...("hero" in card && card.hero ? { hero: heroName(card.hero) } : {}),
    };
  }

  return {
    content,
    catalog: buildCardCatalog(content),
    faces,
    years: [...content.years.keys()].sort(),
    heroName,
    heroesFor: (year) => {
      const level = content.years.get(year)?.heroLevel;
      return heroCards
        .filter((c) => c.type === "hero" && c.level === level)
        .map((c) => ({ heroId: c.type === "hero" ? c.hero : c.id, name: shortHeroName(c.name) }));
    },
  };
}

export function loadBundledContent(): { bundle: ContentBundle | null; issues: ContentIssue[] } {
  const { content, issues } = parseContentSet({ cards: byFileName(cardFiles), years: byFileName(yearFiles) });
  if (issues.length > 0 || content.years.size === 0) return { bundle: null, issues };
  return { bundle: buildBundle(content), issues };
}

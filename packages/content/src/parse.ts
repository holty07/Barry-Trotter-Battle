import type { z } from "zod";
import type { CardCatalog, SeatId, SetupInput } from "@hb/engine";
import { CARD_FILES_BY_TYPE, cardSchema, type Card, type CardType } from "./schema/card.ts";
import { cardTypeSchema, EFFECT_OPS, type CardId } from "./schema/common.ts";
import { SCENARIO_CARD_LIST_FIELDS, yearScenarioSchema, type ScenarioYearId, type YearScenario } from "./schema/year.ts";

// Pure content parsing and resolution — no file system, so the browser
// client can use it too (it gets the raw JSON from Vite at build time; the
// Node CLI and tests get it from loader.ts).

export type ContentIssue = { file: string; message: string };

export type ContentSet = {
  cards: Map<CardId, Card>;
  years: Map<ScenarioYearId, YearScenario>;
};

/** Already-JSON-parsed files, keyed by file name: `cards` by
 * CARD_FILES_BY_TYPE name (e.g. "spells.json"), `years` by "<n>.json".
 * A card file that's absent just means nothing transcribed yet. */
export type RawContentFiles = {
  cards: Record<string, unknown>;
  years: Record<string, unknown>;
};

function formatZodIssues(prefix: string, issues: z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const at = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return `${prefix}${at}: ${issue.message}`;
  });
}

/**
 * Recursively collects every `op` value found under any `effects`/`effect`/
 * `then`/`else`/`reward`/`ability`/`modifier` key, walking plain (possibly
 * schema-invalid) JSON. Used to name an unknown effect op even when the
 * containing card fails schema validation for other reasons too.
 */
export function collectEffectOps(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectEffectOps(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["op"] === "string") into.add(obj["op"]);
    for (const key of Object.keys(obj)) collectEffectOps(obj[key], into);
  }
  return into;
}

const KNOWN_OPS = new Set<string>(EFFECT_OPS);

function parseCardFile(raw: unknown, expectedType: CardType, issues: ContentIssue[]): Card[] {
  const fileName = CARD_FILES_BY_TYPE[expectedType];
  const relPath = `cards/${fileName}`;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ file: relPath, message: "expected a JSON array of cards" });
    return [];
  }

  const cards: Card[] = [];
  raw.forEach((entry, index) => {
    const rawId = (entry as Record<string, unknown> | null)?.["id"];
    const id = typeof rawId === "string" ? rawId : `#${index}`;
    for (const op of collectEffectOps(entry)) {
      if (!KNOWN_OPS.has(op)) {
        issues.push({ file: relPath, message: `card ${id} uses unknown effect op "${op}" — known ops: ${EFFECT_OPS.join(", ")}` });
      }
    }

    const parsed = cardSchema.safeParse(entry);
    if (!parsed.success) {
      issues.push(...formatZodIssues(`${relPath}: card ${id}`, parsed.error.issues).map((message) => ({ file: relPath, message })));
      return;
    }
    if (parsed.data.type !== expectedType) {
      issues.push({
        file: relPath,
        message: `card ${parsed.data.id} has type "${parsed.data.type}" but was found in ${fileName} (expected "${expectedType}")`,
      });
      return;
    }
    cards.push(parsed.data);
  });
  return cards;
}

/** Validates everything, collecting every problem rather than stopping at
 * the first (content:check reports them all). */
export function parseContentSet(raw: RawContentFiles): { content: ContentSet; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const cards = new Map<CardId, Card>();

  for (const type of cardTypeSchema.options) {
    for (const card of parseCardFile(raw.cards[CARD_FILES_BY_TYPE[type]], type, issues)) {
      if (cards.has(card.id)) {
        issues.push({ file: CARD_FILES_BY_TYPE[type], message: `duplicate card id "${card.id}"` });
        continue;
      }
      cards.set(card.id, card);
    }
  }

  const years = new Map<ScenarioYearId, YearScenario>();
  for (const fileName of Object.keys(raw.years).sort()) {
    const relPath = `years/${fileName}`;
    const parsed = yearScenarioSchema.safeParse(raw.years[fileName]);
    if (!parsed.success) {
      issues.push(...formatZodIssues(relPath, parsed.error.issues).map((message) => ({ file: relPath, message })));
      continue;
    }
    const expectedFileName = `${parsed.data.year}.json`;
    if (fileName !== expectedFileName) {
      issues.push({ file: relPath, message: `scenario declares year ${parsed.data.year} but lives in ${fileName} (expected ${expectedFileName})` });
      continue;
    }
    years.set(parsed.data.year, parsed.data);
  }

  for (const [yearId, scenario] of years) {
    for (const field of SCENARIO_CARD_LIST_FIELDS) {
      for (const cardId of scenario[field]) {
        if (!cards.has(cardId)) {
          issues.push({ file: `years/${yearId}.json`, message: `scenario.${field} references unknown card id "${cardId}"` });
        }
      }
    }
  }

  return { content: { cards, years }, issues };
}

/** Throws with every issue listed, for real (non-CLI) consumers. */
export function parseContent(raw: RawContentFiles): ContentSet {
  const { content, issues } = parseContentSet(raw);
  if (issues.length > 0) {
    const lines = issues.map((issue) => `  ${issue.file}: ${issue.message}`);
    throw new Error(`content/ failed validation (${issues.length} issue(s)):\n${lines.join("\n")}`);
  }
  return content;
}

/**
 * A hero's starting deck: every Y0 (evergreen starter) spell/item/ally card
 * tagged with this hero, expanded by `copies` — see docs/03's MarketCard
 * `hero` field. Throws loudly rather than silently handing out an empty
 * deck if the hero id is wrong or the starter cards aren't tagged yet.
 */
export function startingDeckFor(content: ContentSet, heroId: string): CardId[] {
  const deck: CardId[] = [];
  for (const card of content.cards.values()) {
    if (card.introducedIn !== 0) continue;
    if (!("hero" in card) || card.hero !== heroId) continue;
    for (let i = 0; i < card.copies; i++) deck.push(card.id);
  }
  if (deck.length === 0) throw new Error(`startingDeckFor: no Y0 starter cards tagged for hero "${heroId}"`);
  return deck;
}

/** Builds the static per-card facts engine's `setup`/`reduce`/effect
 * resolution needs (see packages/engine/src/catalog.ts) from a loaded
 * `ContentSet`. Engine may not import content, so this conversion lives
 * here rather than there (docs/01 "Repository boundaries"). */
export function buildCardCatalog(content: ContentSet): CardCatalog {
  const catalog: CardCatalog = {};
  for (const card of content.cards.values()) {
    catalog[card.id] = {
      type: card.type,
      cost: "cost" in card ? card.cost : undefined,
      health: "health" in card ? card.health : undefined,
      controlSlots: "controlSlots" in card ? card.controlSlots : undefined,
      darkArtsPerTurn: "darkArtsPerTurn" in card ? card.darkArtsPerTurn : undefined,
      ability: "ability" in card ? card.ability : undefined,
      reward: "reward" in card ? card.reward : undefined,
      effects: card.effects,
    };
  }
  return catalog;
}

function resolvePlayerCountValue<T>(value: T | { "2": T; "3": T; "4": T }, seatCount: 2 | 3 | 4): T {
  if (value !== null && typeof value === "object" && "2" in (value as object)) {
    return (value as { "2": T; "3": T; "4": T })[String(seatCount) as "2" | "3" | "4"];
  }
  return value as T;
}

export type ResolvedYear = {
  year: ScenarioYearId;
  seatCount: 2 | 3 | 4;
  villainSlots: number;
  marketRowSize: number;
  startingHealth: number;
  heroLevel: 1 | 2 | 3;
  flags: YearScenario["flags"];
  rulesDeltas: string[];
  // Flat deck lists — each id repeated once per physical copy (a card's
  // `copies` field), matching what a real shuffled deck contains. Engine's
  // `setup()` takes exactly this shape. Look up `content.cards` directly if
  // you need the deduplicated Card objects instead.
  locations: CardId[];
  villains: CardId[];
  darkArts: CardId[];
  market: CardId[];
};

/** Normalises player-count-dependent scenario values and expands each
 * scenario card-id list into a flat per-copy deck. Throws loudly on a
 * missing scenario or card id — `content:check` uses `parseContentSet`
 * directly instead so it can report every missing id at once rather than
 * stopping at the first. */
export function resolveYear(content: ContentSet, year: ScenarioYearId, seatCount: 2 | 3 | 4): ResolvedYear {
  const scenario = content.years.get(year);
  if (!scenario) throw new Error(`no scenario found for year ${year}`);

  const resolveDeck = (field: (typeof SCENARIO_CARD_LIST_FIELDS)[number]): CardId[] => {
    const deck: CardId[] = [];
    for (const cardId of scenario[field]) {
      const card = content.cards.get(cardId);
      if (!card) throw new Error(`year ${year} scenario.${field} references unknown card id "${cardId}"`);
      for (let i = 0; i < card.copies; i++) deck.push(cardId);
    }
    return deck;
  };

  return {
    year,
    seatCount,
    villainSlots: resolvePlayerCountValue(scenario.villainSlots, seatCount),
    marketRowSize: resolvePlayerCountValue(scenario.marketRowSize, seatCount),
    startingHealth: resolvePlayerCountValue(scenario.startingHealth, seatCount),
    heroLevel: scenario.heroLevel,
    flags: scenario.flags,
    rulesDeltas: scenario.rulesDeltas,
    locations: resolveDeck("locations"),
    villains: resolveDeck("villains"),
    darkArts: resolveDeck("darkArts"),
    market: resolveDeck("market"),
  };
}

/** Everything engine's `setup()` needs to start a real game, from content:
 * the year's resolved decks plus each seat's hero and starting deck. Seats
 * play in the order given. */
export function buildSetupInput(
  content: ContentSet,
  options: { year: ScenarioYearId; seed: number; heroesBySeat: Record<SeatId, string> },
): SetupInput {
  const seats = Object.keys(options.heroesBySeat);
  if (seats.length < 2 || seats.length > 4) throw new Error(`buildSetupInput: 2–4 seats required, got ${seats.length}`);
  const resolved = resolveYear(content, options.year, seats.length as 2 | 3 | 4);
  return {
    seed: options.seed,
    year: options.year,
    seats,
    heroesBySeat: Object.fromEntries(
      seats.map((seat) => {
        const heroId = options.heroesBySeat[seat]!;
        return [seat, { heroId, heroLevel: resolved.heroLevel, startingDeck: startingDeckFor(content, heroId) }];
      }),
    ),
    villainSlotCount: resolved.villainSlots,
    marketRowSize: resolved.marketRowSize,
    startingHealth: resolved.startingHealth,
    market: resolved.market,
    villains: resolved.villains,
    darkArts: resolved.darkArts,
    locations: resolved.locations,
  };
}

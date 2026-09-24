import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { CARD_FILES_BY_TYPE, cardSchema, type Card, type CardType } from "./schema/card.ts";
import { cardTypeSchema, EFFECT_OPS, type CardId } from "./schema/common.ts";
import { SCENARIO_CARD_LIST_FIELDS, yearScenarioSchema, type ScenarioYearId, type YearScenario } from "./schema/year.ts";

export type ContentIssue = { file: string; message: string };

export type ContentSet = {
  cards: Map<CardId, Card>;
  years: Map<ScenarioYearId, YearScenario>;
};

async function readJson(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
}

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

async function loadCardFile(
  contentDir: string,
  expectedType: CardType,
  issues: ContentIssue[],
): Promise<Card[]> {
  const fileName = CARD_FILES_BY_TYPE[expectedType];
  const filePath = path.join(contentDir, "cards", fileName);
  const relPath = path.join("cards", fileName);

  let raw: unknown;
  try {
    raw = await readJson(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    issues.push({ file: relPath, message: `failed to read/parse: ${(err as Error).message}` });
    return [];
  }

  if (!Array.isArray(raw)) {
    issues.push({ file: relPath, message: "expected a JSON array of cards" });
    return [];
  }

  const cards: Card[] = [];
  raw.forEach((entry, index) => {
    const opsUsed = collectEffectOps(entry);
    for (const op of opsUsed) {
      if (!KNOWN_OPS.has(op)) {
        const id = typeof (entry as Record<string, unknown>)?.["id"] === "string" ? (entry as Record<string, unknown>)["id"] : `#${index}`;
        issues.push({
          file: relPath,
          message: `card ${id} uses unknown effect op "${op}" — known ops: ${EFFECT_OPS.join(", ")}`,
        });
      }
    }

    const parsed = cardSchema.safeParse(entry);
    if (!parsed.success) {
      const id = typeof (entry as Record<string, unknown>)?.["id"] === "string" ? (entry as Record<string, unknown>)["id"] : `#${index}`;
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

async function loadYearFiles(contentDir: string, issues: ContentIssue[]): Promise<Map<ScenarioYearId, YearScenario>> {
  const years = new Map<ScenarioYearId, YearScenario>();
  const yearsDir = path.join(contentDir, "years");

  let fileNames: string[];
  try {
    fileNames = (await readdir(yearsDir)).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return years;
    issues.push({ file: "years/", message: `failed to read directory: ${(err as Error).message}` });
    return years;
  }

  for (const fileName of fileNames) {
    const relPath = path.join("years", fileName);
    let raw: unknown;
    try {
      raw = await readJson(path.join(yearsDir, fileName));
    } catch (err) {
      issues.push({ file: relPath, message: `failed to read/parse: ${(err as Error).message}` });
      continue;
    }

    const parsed = yearScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push(...formatZodIssues(`${relPath}`, parsed.error.issues).map((message) => ({ file: relPath, message })));
      continue;
    }

    const expectedFileName = `${parsed.data.year}.json`;
    if (fileName !== expectedFileName) {
      issues.push({
        file: relPath,
        message: `scenario declares year ${parsed.data.year} but lives in ${fileName} (expected ${expectedFileName})`,
      });
      continue;
    }

    years.set(parsed.data.year, parsed.data);
  }

  return years;
}

/**
 * Loads and validates everything under `content/`, collecting every problem
 * found rather than stopping at the first (used by `content:check`).
 * Missing files/directories are treated as "nothing transcribed yet", not
 * an error — that's the expected state before transcription starts.
 */
export async function loadContentSet(contentDir: string): Promise<{ content: ContentSet; issues: ContentIssue[] }> {
  const issues: ContentIssue[] = [];
  const cards = new Map<CardId, Card>();

  for (const type of cardTypeSchema.options) {
    const parsedCards = await loadCardFile(contentDir, type, issues);
    for (const card of parsedCards) {
      if (cards.has(card.id)) {
        issues.push({ file: CARD_FILES_BY_TYPE[type], message: `duplicate card id "${card.id}"` });
        continue;
      }
      cards.set(card.id, card);
    }
  }

  const years = await loadYearFiles(contentDir, issues);

  for (const [yearId, scenario] of years) {
    for (const field of SCENARIO_CARD_LIST_FIELDS) {
      for (const cardId of scenario[field]) {
        if (!cards.has(cardId)) {
          issues.push({
            file: path.join("years", `${yearId}.json`),
            message: `scenario.${field} references unknown card id "${cardId}"`,
          });
        }
      }
    }
  }

  return { content: { cards, years }, issues };
}

/** Fails loudly with every issue listed, for real (non-CLI) consumers. */
export async function loadContent(contentDir: string): Promise<ContentSet> {
  const { content, issues } = await loadContentSet(contentDir);
  if (issues.length > 0) {
    const lines = issues.map((issue) => `  ${issue.file}: ${issue.message}`);
    throw new Error(`content/ failed validation (${issues.length} issue(s)):\n${lines.join("\n")}`);
  }
  return content;
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
 * missing scenario or card id — `content:check` uses `loadContentSet`
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

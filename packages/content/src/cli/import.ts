#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../csv.ts";
import { CARD_FILES_BY_TYPE, cardTypeSchema, type CardType } from "../schema/card.ts";

// Transcription is two passes (docs/03 "Transcription workflow"): this
// importer only ever handles the first — id/name/type/cost/health/copies/
// text — and never touches `effects`. `effects` is a second, separate pass
// done by hand directly in the JSON; re-running the importer must not
// clobber it.
const REQUIRED_COLUMNS = ["id", "name", "type", "introducedIn", "copies", "text"] as const;
const TYPE_SPECIFIC_COLUMNS: Record<CardType, string[]> = {
  spell: ["cost"],
  item: ["cost"],
  ally: ["cost"],
  villain: ["health"],
  darkArts: [],
  location: ["controlSlots"],
  hero: ["hero", "level"],
  proficiency: [],
  horcrux: [],
};

function defaultContentDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../content");
}

type RowError = { row: number; message: string };

function buildCardFromRow(row: Record<string, string>, rowIndex: number, errors: RowError[]): Record<string, unknown> | null {
  for (const col of REQUIRED_COLUMNS) {
    if (!row[col]) {
      errors.push({ row: rowIndex, message: `missing required column "${col}"` });
      return null;
    }
  }

  const typeResult = cardTypeSchema.safeParse(row["type"]);
  if (!typeResult.success) {
    errors.push({ row: rowIndex, message: `unknown type "${row["type"]}"` });
    return null;
  }
  const type = typeResult.data;

  const introducedIn = Number(row["introducedIn"]);
  if (!Number.isInteger(introducedIn) || introducedIn < 0 || introducedIn > 7) {
    errors.push({ row: rowIndex, message: `introducedIn must be an integer 0-7, got "${row["introducedIn"]}"` });
    return null;
  }

  const copies = Number(row["copies"]);
  if (!Number.isInteger(copies) || copies <= 0) {
    errors.push({ row: rowIndex, message: `copies must be a positive integer, got "${row["copies"]}"` });
    return null;
  }

  const card: Record<string, unknown> = {
    id: row["id"],
    name: row["name"],
    type,
    introducedIn,
    copies,
    text: row["text"],
  };
  if (row["notes"]) card["notes"] = row["notes"];

  for (const col of TYPE_SPECIFIC_COLUMNS[type]) {
    const value = row[col];
    if (!value) {
      errors.push({ row: rowIndex, message: `type "${type}" requires column "${col}"` });
      return null;
    }
    if (col === "cost" || col === "health" || col === "controlSlots" || col === "level") {
      const num = Number(value);
      if (!Number.isInteger(num)) {
        errors.push({ row: rowIndex, message: `column "${col}" must be an integer, got "${value}"` });
        return null;
      }
      card[col] = num;
    } else {
      card[col] = value;
    }
  }
  if (type === "villain") card["reward"] = [];

  return card;
}

async function readExistingCards(filePath: string): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>[];
    for (const card of raw) {
      if (typeof card["id"] === "string") map.set(card["id"], card);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return map;
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("usage: content:import <path-to-csv> [contentDir]");
    process.exit(1);
  }
  const contentDir = process.argv[3] ?? defaultContentDir();

  const csvText = await readFile(csvPath, "utf8");
  const rows = parseCsv(csvText);

  const errors: RowError[] = [];
  const byType = new Map<CardType, Map<string, Record<string, unknown>>>();

  rows.forEach((row, index) => {
    const card = buildCardFromRow(row, index + 2 /* header is row 1 */, errors);
    if (!card) return;
    const type = card["type"] as CardType;
    if (!byType.has(type)) byType.set(type, new Map());
    const bucket = byType.get(type)!;
    if (bucket.has(card["id"] as string)) {
      errors.push({ row: index + 2, message: `duplicate id "${card["id"]}" within this CSV` });
      return;
    }
    bucket.set(card["id"] as string, card);
  });

  if (errors.length > 0) {
    console.error(`content:import found ${errors.length} row error(s):`);
    for (const e of errors) console.error(`  row ${e.row}: ${e.message}`);
  }

  await mkdir(path.join(contentDir, "cards"), { recursive: true });

  let created = 0;
  let updated = 0;
  for (const [type, incoming] of byType) {
    const filePath = path.join(contentDir, "cards", CARD_FILES_BY_TYPE[type]);
    const existing = await readExistingCards(filePath);

    for (const [id, incomingCard] of incoming) {
      const prior = existing.get(id);
      if (prior) {
        // Preserve hand-authored fields the CSV never carries.
        existing.set(id, { ...prior, ...incomingCard, effects: prior["effects"] ?? [] });
        updated++;
      } else {
        existing.set(id, { ...incomingCard, effects: [] });
        created++;
      }
    }

    const sorted = [...existing.values()].sort((a, b) => (a["id"] as string).localeCompare(b["id"] as string));
    await writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  }

  console.log(`content:import: ${created} card(s) created, ${updated} updated, ${errors.length} row error(s).`);
  if (errors.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("content:import crashed:", err);
  process.exit(1);
});

#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_TYPES_IN_MATRIX, MATRIX_YEARS, expectedCount } from "../countMatrix.ts";
import { loadContentSet } from "../loader.ts";
import type { CardType } from "../schema/card.ts";

function defaultContentDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../content");
}

async function main(): Promise<void> {
  const contentDir = process.argv[2] ?? process.env["CONTENT_DIR"] ?? defaultContentDir();
  const found = existsSync(contentDir);

  const { content, issues } = await loadContentSet(contentDir);

  console.log(`content:check — ${contentDir}`);
  if (!found) {
    console.log("(content/ does not exist yet — showing the full transcription checklist)\n");
  } else {
    console.log();
  }

  // --- Schema, duplicate-id, unknown-op and scenario-reference issues ---
  if (issues.length > 0) {
    console.log(`Schema & reference issues (${issues.length}):`);
    for (const issue of issues) {
      console.log(`  ✗ ${issue.file}: ${issue.message}`);
    }
    console.log();
  } else {
    console.log("Schema & reference issues: none\n");
  }

  // --- Count matrix ---
  const actual: Record<CardType, Record<number, number>> = Object.fromEntries(
    CARD_TYPES_IN_MATRIX.map((type) => [type, Object.fromEntries(MATRIX_YEARS.map((y) => [y, 0]))]),
  ) as Record<CardType, Record<number, number>>;

  for (const card of content.cards.values()) {
    actual[card.type][card.introducedIn] = (actual[card.type][card.introducedIn] ?? 0) + card.copies;
  }

  const mismatches: { type: CardType; year: number; expected: number; actual: number }[] = [];
  for (const type of CARD_TYPES_IN_MATRIX) {
    for (const year of MATRIX_YEARS) {
      const exp = expectedCount(type, year);
      const act = actual[type][year] ?? 0;
      if (exp !== act) mismatches.push({ type, year, expected: exp, actual: act });
    }
  }

  const totalCells = CARD_TYPES_IN_MATRIX.length * MATRIX_YEARS.length;
  if (mismatches.length === 0) {
    console.log(`Count matrix: all ${totalCells} year × type cells match docs/03.\n`);
  } else {
    console.log(`Count matrix: ${mismatches.length}/${totalCells} cells off:`);
    console.log("  type          year  expected  actual  delta");
    for (const m of mismatches) {
      const delta = m.actual - m.expected;
      const sign = delta > 0 ? "+" : "";
      console.log(
        `  ${m.type.padEnd(12)}  Y${String(m.year).padEnd(3)} ${String(m.expected).padStart(8)}  ${String(m.actual).padStart(6)}  ${sign}${delta}`,
      );
    }
    console.log();
  }

  const ok = issues.length === 0 && mismatches.length === 0;
  console.log(ok ? "content:check passed." : "content:check found problems — see above.");
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("content:check crashed:", err);
  process.exit(1);
});

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CARD_FILES_BY_TYPE } from "./schema/card.ts";
import { parseContentSet, type ContentIssue, type ContentSet, type RawContentFiles } from "./parse.ts";

// Node-only: reads content/ from disk into RawContentFiles and hands it to
// the pure parser. The browser gets the same raw shape from Vite instead.

async function readJsonInto(
  filePath: string,
  relPath: string,
  into: Record<string, unknown>,
  key: string,
  issues: ContentIssue[],
): Promise<void> {
  try {
    into[key] = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    issues.push({ file: relPath, message: `failed to read/parse: ${(err as Error).message}` });
  }
}

/**
 * Loads and validates everything under `content/`, collecting every problem
 * found rather than stopping at the first (used by `content:check`).
 * Missing files/directories are treated as "nothing transcribed yet", not
 * an error — that's the expected state before transcription starts.
 */
export async function loadContentSet(contentDir: string): Promise<{ content: ContentSet; issues: ContentIssue[] }> {
  const readIssues: ContentIssue[] = [];
  const raw: RawContentFiles = { cards: {}, years: {} };

  for (const fileName of Object.values(CARD_FILES_BY_TYPE)) {
    await readJsonInto(path.join(contentDir, "cards", fileName), `cards/${fileName}`, raw.cards, fileName, readIssues);
  }

  const yearsDir = path.join(contentDir, "years");
  let yearFiles: string[] = [];
  try {
    yearFiles = (await readdir(yearsDir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      readIssues.push({ file: "years/", message: `failed to read directory: ${(err as Error).message}` });
    }
  }
  for (const fileName of yearFiles) {
    await readJsonInto(path.join(yearsDir, fileName), `years/${fileName}`, raw.years, fileName, readIssues);
  }

  const { content, issues } = parseContentSet(raw);
  return { content, issues: [...readIssues, ...issues] };
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

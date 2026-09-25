import type { RawContentFiles } from "@hb/content/browser";

// content/ is git-ignored and bundled into the Worker at build time, the same
// way the client does it (apps/web/src/game/content.ts): a deploy from your
// machine carries your card data, the repository never does. Worker tests
// alias this module to test/fixtureFiles.ts.
const cards = import.meta.glob("../../../content/cards/*.json", { eager: true, import: "default" });
const years = import.meta.glob("../../../content/years/*.json", { eager: true, import: "default" });

const byFileName = (files: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(files).map(([path, json]) => [path.slice(path.lastIndexOf("/") + 1), json]));

export const contentFiles: RawContentFiles = { cards: byFileName(cards), years: byFileName(years) };

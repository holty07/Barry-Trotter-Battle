import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const rows = parseCsv("id,name,cost\nspell.a,Test Spell A,1\nspell.b,Test Spell B,2\n");
    expect(rows).toEqual([
      { id: "spell.a", name: "Test Spell A", cost: "1" },
      { id: "spell.b", name: "Test Spell B", cost: "2" },
    ]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseCsv('id,text\nspell.a,"Deal 1 damage, then draw a card"\nspell.b,"She said ""hi"""\n');
    expect(rows).toEqual([
      { id: "spell.a", text: "Deal 1 damage, then draw a card" },
      { id: "spell.b", text: 'She said "hi"' },
    ]);
  });

  it("handles quoted fields containing newlines", () => {
    const rows = parseCsv('id,text\nspell.a,"line one\nline two"\n');
    expect(rows).toEqual([{ id: "spell.a", text: "line one\nline two" }]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

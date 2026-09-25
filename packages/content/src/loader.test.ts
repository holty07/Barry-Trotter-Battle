import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContentSet } from "./loader.ts";
import { resolveYear } from "./parse.ts";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("loadContentSet against a missing content/ dir", () => {
  it("reports no issues and empty maps rather than failing", async () => {
    const { content, issues } = await loadContentSet(path.join(tmpdir(), "hb-content-does-not-exist"));
    expect(issues).toEqual([]);
    expect(content.cards.size).toBe(0);
    expect(content.years.size).toBe(0);
  });
});

describe("loadContentSet against the synthetic fixtures", () => {
  it("loads every fixture card and the fixture year with no issues", async () => {
    const { content, issues } = await loadContentSet(fixturesDir);
    expect(issues).toEqual([]);
    expect(content.cards.size).toBeGreaterThan(0);
    expect(content.years.get(1)).toBeDefined();
  });

  it("resolves the fixture year for every seat count", async () => {
    const { content } = await loadContentSet(fixturesDir);
    for (const seatCount of [2, 3, 4] as const) {
      const resolved = resolveYear(content, 1, seatCount);
      // 3+3+2+2 spells, 2+2 items, 2+1 allies — one entry per physical copy.
      expect(resolved.market.length).toBe(17);
      expect(resolved.villains).toHaveLength(1);
      expect(resolved.startingHealth).toBe(10);
    }
    expect(resolveYear(content, 1, 2).villainSlots).toBe(1);
    expect(resolveYear(content, 1, 4).villainSlots).toBe(2);
  });

  it("repeats a card id once per physical copy, not once per unique id", async () => {
    const { content } = await loadContentSet(fixturesDir);
    const resolved = resolveYear(content, 1, 2);
    const countOf = (id: string) => resolved.market.filter((cardId) => cardId === id).length;
    expect(countOf("spell.test-spell-a")).toBe(3);
    expect(countOf("ally.test-ally-b")).toBe(1);
  });
});

describe("loadContentSet against a deliberately broken content/ dir", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hb-content-broken-"));
    await mkdir(path.join(dir, "cards"), { recursive: true });
    await mkdir(path.join(dir, "years"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports a scenario referencing a missing card id", async () => {
    await writeFile(
      path.join(dir, "years", "1.json"),
      JSON.stringify({
        year: 1,
        villainSlots: 1,
        marketRowSize: 6,
        startingHealth: 10,
        locations: [],
        villains: [],
        darkArts: [],
        market: ["spell.does-not-exist"],
        heroLevel: 1,
        flags: { usesDice: false, usesProficiencies: false, usesHorcruxes: false },
        rulesDeltas: [],
      }),
    );

    const { issues } = await loadContentSet(dir);
    expect(issues.some((i) => i.message.includes("spell.does-not-exist"))).toBe(true);
  });

  it("reports a card placed in the wrong type file", async () => {
    await writeFile(
      path.join(dir, "cards", "items.json"),
      JSON.stringify([
        {
          id: "spell.misfiled",
          name: "Misfiled",
          type: "spell",
          introducedIn: 1,
          copies: 1,
          cost: 1,
          text: "x",
          effects: [],
        },
      ]),
    );

    const { issues } = await loadContentSet(dir);
    expect(issues.some((i) => i.message.includes("expected \"item\""))).toBe(true);
  });

  it("reports a card using an unknown effect op", async () => {
    await writeFile(
      path.join(dir, "cards", "spells.json"),
      JSON.stringify([
        {
          id: "spell.bad-op",
          name: "Bad Op",
          type: "spell",
          introducedIn: 1,
          copies: 1,
          cost: 1,
          text: "x",
          effects: [{ op: "obliviate", amount: 1 }],
        },
      ]),
    );

    const { issues } = await loadContentSet(dir);
    expect(issues.some((i) => i.message.includes('unknown effect op "obliviate"'))).toBe(true);
  });

  it("reports a duplicate card id across files", async () => {
    const card = {
      id: "spell.dup",
      name: "Dup",
      type: "spell",
      introducedIn: 1,
      copies: 1,
      cost: 1,
      text: "x",
      effects: [],
    };
    await writeFile(path.join(dir, "cards", "spells.json"), JSON.stringify([card, card]));

    const { issues } = await loadContentSet(dir);
    expect(issues.some((i) => i.message.includes("duplicate card id"))).toBe(true);
  });
});

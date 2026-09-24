import { describe, expect, it } from "vitest";
import { nextInt, shuffle } from "./rng.ts";
import type { Rng } from "./types.ts";

describe("nextInt", () => {
  it("is deterministic for the same seed and cursor", () => {
    const rng: Rng = { seed: 42, cursor: 0 };
    const [a] = nextInt(rng, 100);
    const [b] = nextInt(rng, 100);
    expect(a).toBe(b);
  });

  it("advances the cursor and never repeats seed/cursor", () => {
    let rng: Rng = { seed: 7, cursor: 0 };
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const [value, next] = nextInt(rng, 1000);
      expect(next.cursor).toBe(rng.cursor + 1);
      expect(next.seed).toBe(rng.seed);
      seen.add(value);
      rng = next;
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("stays within [0, maxExclusive)", () => {
    let rng: Rng = { seed: 1, cursor: 0 };
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextInt(rng, 6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      rng = next;
    }
  });

  it("different seeds produce different sequences", () => {
    const [a] = nextInt({ seed: 1, cursor: 0 }, 1_000_000);
    const [b] = nextInt({ seed: 2, cursor: 0 }, 1_000_000);
    expect(a).not.toBe(b);
  });
});

describe("shuffle", () => {
  it("is a permutation of the input (card conservation)", () => {
    const items = Array.from({ length: 20 }, (_, i) => `card-${i}`);
    const [shuffled] = shuffle(items, { seed: 123, cursor: 0 });
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("is deterministic for the same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const [a] = shuffle(items, { seed: 99, cursor: 0 });
    const [b] = shuffle(items, { seed: 99, cursor: 0 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different orders", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const [a] = shuffle(items, { seed: 1, cursor: 0 });
    const [b] = shuffle(items, { seed: 2, cursor: 0 });
    expect(a).not.toEqual(b);
  });

  it("advances the rng cursor by the number of swaps", () => {
    const [, next] = shuffle([1, 2, 3, 4], { seed: 5, cursor: 0 });
    expect(next.cursor).toBe(3); // n-1 swaps for n items
  });
});

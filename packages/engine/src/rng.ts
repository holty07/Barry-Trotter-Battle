import type { Rng } from "./types.ts";

// splitmix32, counter-based: `cursor` is the call count, `seed` never
// changes. Each (seed, cursor) pair hashes to one deterministic value, which
// is what lets a snapshot + action log replay byte-identically (docs/02
// "Deterministic randomness"). Never touch Math.random/Date.now/crypto here.
const GOLDEN_GAMMA = 0x9e3779b9;

function mix32(input: number): number {
  let z = input | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

export function nextInt(rng: Rng, maxExclusive: number): [number, Rng] {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`nextInt: maxExclusive must be a positive integer, got ${maxExclusive}`);
  }
  const cursor = rng.cursor + 1;
  const hashed = mix32((rng.seed + Math.imul(cursor, GOLDEN_GAMMA)) | 0);
  return [hashed % maxExclusive, { seed: rng.seed, cursor }];
}

export function shuffle<T>(items: readonly T[], rng: Rng): [T[], Rng] {
  const result = [...items];
  let current = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, next] = nextInt(current, i + 1);
    current = next;
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return [result, current];
}

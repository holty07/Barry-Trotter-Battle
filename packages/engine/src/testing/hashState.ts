import type { GameState } from "../types.ts";

// A short, deterministic fingerprint for golden-replay tests (docs/02
// "Replay determinism") — not cryptographic, just stable and cheap.
export function hashState(state: GameState): string {
  const json = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (Math.imul(hash, 31) + json.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

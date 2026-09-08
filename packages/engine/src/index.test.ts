import { describe, expect, it } from "vitest";
import { ENGINE_PLACEHOLDER } from "./index.js";

describe("engine scaffold", () => {
  it("is importable and pure", () => {
    expect(ENGINE_PLACEHOLDER).toBe("hogwarts-battle-engine");
  });
});

import { describe, expect, it } from "vitest";
import { CONTENT_PLACEHOLDER } from "./index.js";

describe("content scaffold", () => {
  it("is importable and may depend on @hb/engine", () => {
    expect(CONTENT_PLACEHOLDER).toBe("hogwarts-battle-content");
  });
});

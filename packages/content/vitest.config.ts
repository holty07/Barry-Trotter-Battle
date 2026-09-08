import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "content",
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

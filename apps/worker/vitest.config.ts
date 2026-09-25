import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  resolve: {
    // content/ is git-ignored; tests run the room against synthetic fixtures.
    alias: [{ find: /^\.\/contentFiles\.ts$/, replacement: path.resolve(import.meta.dirname, "test/fixtureFiles.ts") }],
  },
  test: {
    name: "worker",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

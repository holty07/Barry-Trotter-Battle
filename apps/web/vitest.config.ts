import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Deliberately separate from vite.config.ts: the dev/build config wires
// in the cloudflare() plugin against ../worker/wrangler.jsonc, which
// vitest doesn't need for plain component tests.
export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

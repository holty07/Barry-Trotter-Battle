import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// wrangler.jsonc and the GameRoom Durable Object live in ../worker — see
// docs/01-architecture.md for the repository boundaries. `configPath`
// lets this Vite project (the client) drive the real Worker runtime
// without co-locating wrangler config here.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ configPath: "../worker/wrangler.jsonc" }),
  ],
});

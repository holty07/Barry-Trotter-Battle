# Hogwarts Battle — digital co-op adaptation

Read this file at the start of every session. Then read `docs/06-milestones.md` and work
only on the current milestone.

## What this is

A digital, browser-based adaptation of the co-operative deck-builder *Harry Potter: Hogwarts
Battle* (base game, Games/Years 1–7). Built for private online co-op play between 2–4 people,
self-hostable for free.

Not in scope: the Monster Box or Charms & Potions expansions. Not in scope: AI opponents,
matchmaking, accounts, chat.

## Stack (locked — do not substitute)

| Layer | Choice |
|---|---|
| Language | TypeScript, strict mode, ESM |
| Monorepo | npm workspaces (no pnpm/yarn/turbo) |
| Engine | Pure TS, zero runtime dependencies |
| Validation | zod (content loading only, never in the engine hot path) |
| Client | Vite + React 19 + Tailwind |
| Server | Cloudflare Worker + one Durable Object per game room (SQLite storage, WebSocket Hibernation API) |
| Local dev | `@cloudflare/vite-plugin` — one dev server runs both client and Worker runtime |
| Tests | Vitest, plus `@cloudflare/vitest-pool-workers` for the Durable Object |
| Deploy | Wrangler to Cloudflare Workers free plan |

## Workspace layout

```
packages/engine/     pure game logic — no I/O, no network, no DOM, no Date, no Math.random
packages/content/    card schema, loader, validator, synthetic test fixtures
packages/protocol/   shared wire types between client and Worker
apps/web/            React client
apps/worker/         Worker entry + GameRoom Durable Object + serves the built client
content/             MY transcribed card data — GIT-IGNORED, see docs/03-content-schema.md
docs/                the specs. Treat these as the source of truth over your own assumptions.
```

## Hard rules

1. **The engine is pure.** `reduce(state, action) -> { state, events }`. No async, no
   `Math.random`, no `Date.now`, no mutation of the input state. Every random draw goes through
   the seeded RNG in state. If you are tempted to break this, stop and ask.
2. **No card text or artwork in the repository.** The rules and mechanics are fair game; the
   printed card text and art belong to their publisher. All card data loads at runtime from
   `content/`, which is git-ignored. Engine tests use synthetic fixture cards with made-up
   names (`Test Spell A`), never real ones. Never commit anything from `content/`.
3. **Never invent a rule.** If a card effect, timing window or per-year rule change is not
   already specified in `content/` or `docs/`, do not guess it — add a `TODO(rules)` and tell
   me. A plausible-looking wrong rule is worse than a gap.
4. **Data over code for card effects.** Card behaviour is declarative effect data interpreted
   by the engine. There is no `if (cardId === 'x')` anywhere in the engine.
5. **Australian spelling** in all UI copy, comments and docs (behaviour, colour, initialise).
6. **Small commits, tests first.** Every engine behaviour lands with a Vitest case. Do not move
   to the next milestone until `npm test` and `npm run typecheck` are clean.
7. Ask before adding any dependency to `packages/engine`. The answer is almost always no.

## Working style I want from you

- Before writing code for a milestone, restate the milestone's definition of done and list the
  files you will touch. Wait for my go-ahead on anything architectural.
- Prefer many small pure functions over large ones. Name things after the game's own vocabulary
  (villain, location, market, stun) not generic ones (entity, node, item).
- When you hit an ambiguity in the rules or the spec, stop and ask. Do not paper over it.
- Do not refactor across milestone boundaries without asking.

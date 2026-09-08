# 06 — Milestones and Claude Code prompts

Work one milestone per session where you can. Each prompt below is written to be pasted directly.
Don't start a milestone until the previous one's definition of done is met.

---

## M0 — Scaffold, CI, and a deployed hello world

**Why first:** the deploy path is the only part of this you can't test locally, so prove it before
there's anything to lose.

**Definition of done**
- `npm run dev`, `npm test`, `npm run typecheck` all work from the repo root
- A Durable Object counter increments over a WebSocket, locally and on a deployed URL
- Import boundaries are lint-enforced; `content/` is git-ignored
- One commit, pushed

**Prompt**

> Read CLAUDE.md and docs/01-architecture.md, then scaffold this monorepo.
>
> Set up npm workspaces with `packages/engine`, `packages/content`, `packages/protocol`,
> `apps/web`, `apps/worker`. TypeScript strict, ESM, a shared base tsconfig with project
> references. Vitest at the root running all workspaces. ESLint with an import-boundary rule that
> enforces the dependency direction in CLAUDE.md.
>
> `apps/web` is Vite + React + Tailwind. `apps/worker` is a Worker that serves the built client
> via Workers Assets and exposes one Durable Object class called `GameRoom`, registered with a
> `new_sqlite_classes` migration. Wire up `@cloudflare/vite-plugin` so a single `npm run dev` at
> the root runs the client and the real Worker runtime with working Durable Objects.
>
> Check the current Cloudflare docs for the exact scaffolding commands and config keys before you
> run anything — these change, and I'd rather you verify than guess. Tell me what you verified.
>
> For the hello world: `GameRoom` accepts a WebSocket using the Hibernation API
> (`ctx.acceptWebSocket`, `webSocketMessage`, no `ws.accept()`, no timers), keeps a counter in
> SQLite storage, and broadcasts the new value to all connected sockets on each increment. The
> client connects, shows the counter and has a button. Add a `@cloudflare/vitest-pool-workers`
> test that opens two sockets and asserts both see the increment.
>
> Add `content/` to `.gitignore`. Then stop and tell me the deploy command to run — I'll do the
> `wrangler login` and first deploy myself.

---

## M1 — Content schema, loader, validator, Year 1 data

**Definition of done**
- `npm run content:check` validates `content/` against the count matrix and reports gaps clearly
- Year 1 fully transcribed by you and passing validation
- Synthetic fixtures in `packages/content/fixtures` for engine tests

**Prompt**

> Read docs/02-engine-spec.md and docs/03-content-schema.md.
>
> In `packages/content`: define the zod schemas for every card type and the year scenario file,
> exactly as specced. Write a loader that reads `content/` and returns a typed, normalised
> `ContentSet`, resolving player-count-dependent scenario values. Write `content:check` as a CLI
> that validates schema, asserts the per-year per-type `copies` totals against the count matrix
> in docs/03, checks that every card id referenced by a scenario exists, and checks that every
> effect `op` used is one the engine implements. Its output should tell me exactly which year and
> type is off and by how many.
>
> Also write a CSV importer (`content:import`) so I can type card rows into a spreadsheet and
> convert them to `content/cards/*.json`. Include the CSV column template in the docs.
>
> Then build a synthetic fixture set in `packages/content/fixtures`: a fake year with made-up card
> names covering every effect op, for the engine tests to use. No real card names or text
> anywhere in the repo.
>
> Do not create any real card data. I'm transcribing that from my own copy.

Then transcribe Year 1 yourself. Expect a few sessions. Run `content:check` until it's green.

---

## M2 — Engine core, Year 1 playable headless

**The riskiest milestone.** Do it in the sub-steps below, in order, and don't let it be done in
one giant pass.

**Definition of done**
- A full Year 1 game is playable through `reduce` calls in a test, start to win/loss
- The property tests in docs/02 all pass
- A golden replay test: recorded action log + seed produces a stable state hash

**Prompt (2a — skeleton)**

> Read docs/02-engine-spec.md in full. Implement, in `packages/engine`, in this order, stopping
> after each for me to review:
>
> 1. `GameState` types, the splitmix32 RNG with `nextInt`/`shuffle`, state serialisation
>    round-trip test.
> 2. `setup(content, year, seats, seed)` producing a valid initial state, plus the card
>    conservation invariant as a reusable test helper.
> 3. The phase machine and `advancePhase`, with no card effects yet — just the turn skeleton and
>    resource reset.
>
> Nothing async, nothing impure. Tests use the synthetic fixtures, not real cards.

**Prompt (2b — resolution)**

> Now the effect resolution stack, exactly as specced in docs/02: `Frame`, `drain`, `PendingInput`,
> and `respondToInput`. Implement the effect ops in three batches, with tests per op using the
> fixtures: first resources and cards, then board effects, then control flow (`sequence`,
> `chooseOne`, `chooseTarget`, `forEach`, `ifThen`, `repeat`).
>
> Assert the invariant that a state is only stable when `resolution` is empty and `pending` is
> null, and that while `pending` is set, every action except `respondToInput` from the right seat
> is rejected. Add the iteration cap on `drain`.

**Prompt (2c — triggers and the real game)**

> Now `Modifier`, `emit`, and the trigger ordering specced in docs/02 — with the order written as
> a comment and asserted by a test. Then wire villains, locations, Dark Arts and hero stunning
> through modifiers rather than bespoke systems.
>
> Then write a test that plays a complete Year 1 game against my `content/` data: seat two heroes,
> take turns, buy cards, defeat the villains, and assert a win. Write a second one that loses by
> control tokens. Record both as golden replays (seed + action log + final state hash).
>
> Where my card data has an effect you can't resolve, fail loudly with the card id — don't skip it.

---

## M3 — Web client, hot-seat in one browser

**Definition of done**
- A full Year 1 game playable in one browser window, no server involved
- Every prompt in the game comes from `view.pending`
- Responsive to iPad portrait

**Prompt**

> Read docs/05-ui.md. Build the React client for hot-seat play: the engine runs in the browser,
> all seats on one screen, no networking. Implement Home, Lobby, Table and End screens, the table
> layout in docs/05, and the pending-input sheet.
>
> Before writing components, propose the token system (colours, type scale, spacing) as code and
> show me one static Table screenshot at desktop and iPad widths. I'll approve the look before you
> build the rest.
>
> The client must contain zero rules logic. Every choice presented to the player is rendered from
> `view.pending`. Card legality hints may be derived from the view, but actions always go through
> `reduce` and rejections are handled.

---

## M4 — Real co-op over Durable Objects

**Definition of done**
- Two browsers, two seats, a full game played remotely
- Kill one client mid-turn: it reconnects and resyncs with no state loss
- Restart the Worker between two actions: the room rebuilds from storage and play continues
- Deployed and played end to end with someone else

**Prompt**

> Read docs/04-multiplayer.md. Move the authoritative engine into the `GameRoom` Durable Object.
>
> Implement: the room routes, room code generation, the wire protocol in `packages/protocol`,
> seat claiming bound to a `localStorage` playerId, `viewFor` redaction as a whitelist, the
> SQLite action log with snapshots every 25 actions, replay-from-storage on construction, `seq`
> based idempotency, and the 30-day cleanup alarm.
>
> The client keeps hot-seat mode as a separate path — don't delete it, it's how I debug the engine.
>
> Write worker tests for: two clients seeing consistent views, a duplicate `seq` being ignored,
> a client reconnecting and resyncing, and a redaction test asserting no deck order or RNG seed
> appears in any view for any seat. That last one is the important one.

---

## M5 — Years 2 to 7

Transcribe each year, then extend. Do them one at a time and play each before moving on.

**Per-year prompt**

> I've transcribed Year N into `content/`. Run `content:check`, then read the year's
> `rulesDeltas` and tell me which of them the engine doesn't yet support. Propose the smallest
> change for each — new effect ops or scenario flags, not special cases. Wait for my go-ahead,
> then implement with tests and a golden replay of a full Year N game.

Known additions by year, from the component list — treat as a heads-up, confirm each against the
year's mini-manual: Hero level 2 cards in Year 3 and level 3 in Year 7; two spell-linked tokens in
Year 3; four house dice in Year 4; nine Proficiencies in Year 6 (choose one per player at setup);
six Horcruxes and four tokens in Year 7. Villain slot counts and Dark Arts counts per turn change
between years too — those belong in the scenario file.

---

## M6 — Quality of life

In priority order, and only after Year 7 plays:

1. **Save and resume.** Already implicit in the event log — this is mostly a lobby UI for
   rejoining an in-progress room and a room list per player.
2. **Game log.** You have `LogEntry` from the start; render it as a readable side drawer with
   filtering by turn. This is also your best debugging tool.
3. **Undo.** Cheap because of the event log: truncate the log and replay. Restrict it to "undo my
   last action, if nothing random has happened since" — undoing across a shuffle or a Dark Arts
   reveal leaks information. Make that rule explicit and enforce it server-side.
4. **Campaign mode.** Carry seats and hero picks across years; track which years you've beaten.
5. **Sounds, animations, card art.** Art is yours to source or draw — don't ship anything
   published. Placeholder is fine; a coloured type-mark per card type reads well enough to play.

---

## Testing strategy, summarised

- Engine: unit tests per effect op against synthetic fixtures; property tests for the invariants
  in docs/02; golden replays per year against your real content.
- Content: `content:check` in CI (it can run against the fixtures in CI, since `content/` isn't
  committed — keep a local pre-push hook for the real data).
- Worker: `@cloudflare/vitest-pool-workers` for socket behaviour, idempotency, redaction and
  rebuild-from-storage.
- Client: light. Snapshot the token system, test the pending-sheet renders from a view fixture,
  and otherwise rely on playing it.

The redaction test and the card conservation test are the two that will save you the most pain.
Write them early and never let them be skipped.

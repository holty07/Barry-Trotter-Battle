# 00 — Decisions, assumptions and risks

Read this before M0. If any assumption is wrong, tell me and I'll revise the affected doc — most
are cheap to change now and expensive to change at M4.

## Locked decisions

| Decision | Choice | Reversible later? |
|---|---|---|
| Scope | Base game, Years 1–7. No expansions. | Yes — expansions are content, not code, if the effect vocabulary holds |
| Players | 2–4, remote, one browser each | Yes |
| Authority | Server-authoritative, redacted per-player views | No. Retrofitting this is a rewrite |
| Engine | Pure, deterministic, seeded RNG, event-sourced | No. This is the foundation of testing and persistence |
| Effect model | Declarative effect data on a resolution stack with explicit pending input | No. This is the decision that decides whether Year 5 is possible |
| Hosting | Cloudflare Workers + one Durable Object per room, free plan | Mostly — the engine is portable, the DO layer is ~1 file to swap |
| Card data | Transcribed by you, git-ignored, loaded at runtime | Yes |
| Client | React + Vite + Tailwind, no rules logic | Yes |
| Identity | `localStorage` UUID, room codes, no accounts | Yes |

## Assumptions I've made

1. **You own the game and can transcribe from the cards.** If not, this project stalls at M1 —
   there is no reliable public database of card text, and reconstructing it from an AI's memory
   produces something ~94% correct, which is the worst possible accuracy for a rules engine.
2. **Private play only.** Room codes are unguessable-ish, not secure. Nothing is publicly
   discoverable, but anyone with a code can take a seat.
3. **You're happy using a Cloudflare account.** Workers and Durable Objects are on the free plan
   with no card required. If you'd rather self-host on your own machine, say so — the change is
   to `apps/worker` only, and the fallback is a small Node + `ws` server plus SQLite, but then
   games only work while your desktop is awake.
4. **Hands are visible to all players by default.** That's how co-ops actually get played at a
   table and it makes advising each other possible. It's a room setting either way.
5. **No card art initially.** Type-marks and colour per card type. Anything published is off the
   table; anything you draw or commission is yours to add.

## Open questions for you

- **Do you want a hot-seat mode kept permanently**, for playing on one screen with your wife in
  the same room? The plan keeps it (it's also the best debugging surface) but it's a small ongoing
  cost in the client.
- **Undo:** worth it, or not? It's cheap mechanically but the information-leak rule around
  shuffles and Dark Arts reveals needs a decision from you.
- **Campaign continuity:** do you care about carrying results between years, or is each year a
  standalone session?

## Risks, honestly

| Risk | Severity | Mitigation in the plan |
|---|---|---|
| Card transcription is a slog and stalls the project | High — most likely cause of failure | Year 1 only before M2; every mechanic in the game shows up in Year 1, so you get a playable game for ~20% of the typing |
| Card text errors become silent bugs | High | Two-pass transcription (text, then effects, separately); `content:check` against a sourced count matrix; golden replays |
| Effect vocabulary can't express a card | Medium | Batch the misfits and extend the vocabulary once per year, rather than special-casing |
| Trigger ordering bugs | Medium | Explicit documented order, asserted by test, single `emit` path |
| Hidden information leaking to clients | Medium | Whitelist redaction plus a test asserting no deck order or seed in any view |
| Durable Object hibernation eating in-memory state | Low | Event log plus snapshots, rebuild in the constructor, no timers |
| Free-tier limits | Very low | A private game generates a few hundred billable requests a session against 100k/day |
| Scope creep into expansions | Medium | Explicitly out of scope in CLAUDE.md |

## What I'd cut if you wanted this playable in a fortnight

M0, M1 for Year 1 only, M2, M3. That's a single-browser hot-seat Year 1 game with real rules,
which is genuinely fun and proves everything hard. M4 turns it into remote co-op. Years 2–7 are
then typing plus small increments.

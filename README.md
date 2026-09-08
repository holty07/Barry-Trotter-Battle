# Setup — read this first

## Before you start

You need:

- Node 22+ and npm
- A Cloudflare account (free plan is enough — no card required for Workers + Durable Objects)
- Your physical copy of the game, for transcribing card data (see `docs/03-content-schema.md`).
  This is the long pole of the whole project, and nothing downstream of Milestone 2 works
  without it.

## Dropping this on your machine

```bash
mkdir -p ~/dev/hogwarts-battle && cd ~/dev/hogwarts-battle
# copy CLAUDE.md, README.md and docs/ into this directory
git init
claude
```

Then paste the Milestone 0 prompt from `docs/06-milestones.md`.

If you'd rather reuse the existing `~/dev/agy/Hogwarts-Battle/` folder, that's fine — just make
sure it's empty apart from these docs before M0 scaffolds into it.

## Commands (once M0 is done)

```bash
npm install           # once, at the repo root
npm run dev           # Vite + Worker runtime + Durable Object, all local, on :5173
npm test              # Vitest across all workspaces
npm run typecheck     # tsc --noEmit across all workspaces
npm run content:check # validate content/ against the card count matrix
npm run deploy        # wrangler deploy — builds the client and uploads Worker + assets
```

`npm run dev` gives you real Durable Objects locally via Miniflare, so multiplayer is fully
testable offline. Open two browser windows to play both seats.

## Order of work

Do the milestones in order. They are sequenced so that you have something playable as early as
possible and so that the risky parts (effect resolution, hidden information) are proven before
you commit to transcribing 250 cards.

| # | Milestone | Why it's here |
|---|---|---|
| 0 | Scaffold, CI, deploy a hello-world | Prove the deploy path before writing logic |
| 1 | Content schema + validator + Year 1 transcription | Data model is the foundation |
| 2 | Engine core, hot-seat, Year 1 playable in tests | The hard part, proven headless |
| 3 | Web client, single-browser hot-seat | Proves the engine and the UI contract |
| 4 | Durable Object rooms, real co-op | Networking on a working game |
| 5 | Years 2–7 content and mechanics | Volume work, low risk by now |
| 6 | Save/resume, undo, game log, polish | Quality of life |

## The one thing that will sink this

Card data quality. A "may" that should be "must", or a target that's one hero rather than all
heroes, becomes a silent bug that surfaces two years later mid-game. Transcribe from the cards
themselves, run `content:check` against the count matrix, and treat the per-year mini-manuals as
the authority for rules changes. Do not let an AI reconstruct card text from memory — it will be
about 94% right, which is the worst possible number.

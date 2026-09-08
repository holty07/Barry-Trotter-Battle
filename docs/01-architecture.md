# 01 — Architecture

## Shape

```
  Browser (React)                Cloudflare edge
  ┌──────────────┐   WebSocket   ┌──────────────────────────────┐
  │ view state   │ ◄───────────► │ Worker (routes + static SPA) │
  │ intents      │               │        │                     │
  └──────────────┘               │        ▼                     │
                                 │  GameRoom Durable Object     │
  ┌──────────────┐               │  ├─ authoritative GameState  │
  │ same engine  │  ← identical  │  ├─ @hb/engine (same code)   │
  │ for hot-seat │    package    │  └─ SQLite: events+snapshot   │
  └──────────────┘               └──────────────────────────────┘
```

One Durable Object instance per room, addressed by `idFromName(roomCode)`. It holds the only
authoritative copy of the game state, runs the engine, persists an append-only event log to its
own SQLite storage, and fans out redacted per-player views over hibernatable WebSockets.

The client holds no game logic. It renders a view the server sends it and posts intents back.
The engine package is imported by both, but the client only uses it for type definitions and for
offline hot-seat mode.

## Why this stack

**Why an authoritative server at all, for a co-op game?** Because of the deck. Whoever holds the
deck order can see the future. Peer-to-peer or client-authoritative state means every player's
browser knows the top of the Dark Arts deck, and the temptation is real. Server-authoritative
with per-player redaction removes the possibility rather than relying on restraint.

**Why Cloudflare Durable Objects.** A game room is a small, long-lived, stateful, single-writer
thing with a handful of WebSockets attached — which is precisely what a Durable Object is. The
alternatives are worse for this shape: a plain Node server on a free tier either spins down mid-
game or costs money to keep warm, and horizontal scaling would then need Redis pub/sub to route
players in the same room to the same process. A DO makes that problem not exist.

It also fits the free plan. Durable Objects have been available on the Workers free plan since
April 2025 (SQLite-backed classes only, which is what we want anyway). The free allowance is
100,000 DO requests/day and 13,000 GB-s/day of compute duration, and inbound WebSocket messages
bill at 20:1 against the request count. With the Hibernation API, an idle room with sockets
attached costs no duration at all — it sleeps after 10 seconds of quiet and Cloudflare keeps the
TCP connections open, waking the object on the next message. A four-player game generating a few
thousand messages an evening is nowhere near any limit.

**Why not just self-host on my own machine?** You can — the engine and Worker are portable, and
`npm run dev` is a fully local server. But then games only work while your desktop is on, and
you're doing tunnelling and DNS. Cloudflare gives you a URL your wife can open from anywhere.

## Consequences to design around

1. **Hibernation means in-memory state is discarded.** The DO can be evicted between any two
   messages. Everything needed to resume must be in SQLite. Restore WebSockets from
   `ctx.getWebSockets()` in the constructor, and never use `setTimeout`/`setInterval` (they
   prevent hibernation) — use the Alarms API instead.
2. **No `ws.accept()`.** Use `ctx.acceptWebSocket(ws)` and the `webSocketMessage` /
   `webSocketClose` handlers, or you pay duration for the whole connection and lose hibernation.
3. **Single-threaded per object, but async can interleave.** Keep the message handler
   synchronous through the engine call: read state, reduce, persist, broadcast. No awaits in the
   middle of a state transition.
4. **State must be fully serialisable.** No class instances, no `Map`/`Set`, no functions in
   `GameState`. Plain JSON only. This is why the RNG is a seed plus a cursor rather than a
   generator object.

## Data flow for a single move

1. Client sends `{ t: "action", seq: 41, action: { type: "playCard", cardId } }`.
2. DO loads current state (in memory, or rehydrated from snapshot + events).
3. Rejects if: not that player's seat, `seq` already applied (duplicate from a reconnect), or
   the engine says the action is illegal.
4. `reduce(state, action)` returns the next state plus a list of domain events.
5. Append the action to the SQLite event log; snapshot every N actions.
6. For each connected socket, compute `viewFor(playerId, state)` and send it.

Rejections are always the server's word against the client's. The client never applies an action
optimistically — latency to the edge is low enough that it doesn't need to, and optimistic
prediction plus hidden information plus a stack-based effect resolver is a bug factory.

## Repository boundaries

`packages/engine` may not import from anything except itself. `packages/content` may import
engine types. `apps/*` may import all three packages. Nothing may import from `apps/*`. Enforce
this with a lint rule in M0 so it can't rot.

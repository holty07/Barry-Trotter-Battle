# 04 — Multiplayer, rooms and persistence

## Routes

| Route | Behaviour |
|---|---|
| `GET /*` | Workers Assets serves the built SPA |
| `POST /api/rooms` | Creates a room: generates a code, returns it. Seeds the DO. |
| `GET /api/rooms/:code` | Lobby metadata (year, seats taken, in progress) — no game state |
| `GET /api/rooms/:code/ws` | WebSocket upgrade, forwarded to `GAME_ROOM.getByName(code)` |

Room codes: 6 characters from an unambiguous alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no
O/0/I/1/L). That's ~10^9 combinations, which for a handful of private games is fine. Be honest
with yourself that this is obscurity, not authentication: anyone with the code can take a seat.
For the intended use — you, your wife, maybe two friends — that's the right trade. Don't post
codes publicly.

## Wire protocol

Shared types live in `packages/protocol`. Discriminate on `t`.

Client → server:

```ts
| { t: "hello"; playerId: string; name: string; lastSeq?: number }
| { t: "takeSeat"; seat: SeatId; heroId: HeroId }
| { t: "startGame"; year: YearId }
| { t: "action"; seq: number; action: Action }
| { t: "resync" }
| { t: "ping" }
```

Server → client:

```ts
| { t: "welcome"; you: SeatId | null; room: RoomMeta }
| { t: "view"; version: number; view: PlayerView; log: LogEntry[] }
| { t: "rejected"; seq: number; reason: RejectReason }
| { t: "error"; message: string }
```

Send the whole redacted view on every change rather than diffs. A view is a few kilobytes of JSON;
diffing is an optimisation you don't need and a source of desync you don't want. Revisit only if
you actually see a problem.

`seq` is a per-client monotonic counter. The DO stores the highest applied `seq` per player and
ignores anything at or below it, which makes reconnect-and-replay safe. Idempotency here is not
optional — a dropped socket mid-action is the normal case on mobile.

## Redaction

```ts
function viewFor(seat: SeatId | null, state: GameState): PlayerView;
```

Rules:

- Deck contents anywhere → replaced with a count. Market deck, Dark Arts deck, Villain deck,
  Horcrux deck, and every player's own deck included.
- Discard piles → full contents (they're public in the physical game).
- Other players' hands → configurable per room: `open` (default, matches how people actually play
  a co-op at a table and makes advising each other possible) or `hidden`. Store the choice in
  room meta; the redactor reads it. Your own hand is always visible to you.
- `pending` → only sent to the seat that must answer, plus a flag to everyone else so their UI
  can show "waiting for Hermione".
- `rng` → never sent. Sending the seed would let a client predict every future shuffle.
- Spectator (`seat === null`) → same as `open` minus the ability to act.

Write `viewFor` as a whitelist that constructs a new object, not a blacklist that deletes fields.
A blacklist leaks the day you add a field.

## Persistence

SQLite-backed Durable Object (`new_sqlite_classes` in the wrangler migration — the free plan only
supports SQLite-backed classes, and new KV-backed namespaces are no longer created for accounts
that don't already have one).

```sql
CREATE TABLE IF NOT EXISTS meta      (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS actions   (n INTEGER PRIMARY KEY, seat TEXT, json TEXT);
CREATE TABLE IF NOT EXISTS snapshots (n INTEGER PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS seats     (seat TEXT PRIMARY KEY, player_id TEXT, name TEXT, last_seq INTEGER);
```

Append each accepted action; snapshot the whole state every 25 actions and delete older
snapshots. On construction, load the latest snapshot and replay any later actions through the
engine. That replay path *is* the determinism test in production — if it diverges, you have an
impurity in the engine, and you want to find out on turn three rather than in Year 7.

Keep one in-memory copy of the state as a cache, but treat it as disposable: hibernation discards
it and the constructor rebuilds from storage.

## Hibernation specifics

- `ctx.acceptWebSocket(ws)`, never `ws.accept()`.
- Handle `webSocketMessage`, `webSocketClose`, `webSocketError` as DO methods.
- Store the seat on the socket with `ws.serializeAttachment({ seat, playerId })` — after
  hibernation you have no in-memory socket map, so recover state from
  `ctx.getWebSockets()` and each socket's `deserializeAttachment()`.
- No `setTimeout` / `setInterval` anywhere in the DO — they block hibernation. Use
  `ctx.storage.setAlarm()`.
- Set an alarm for 30 days out on each action; when it fires with no recent activity, delete the
  room's storage so abandoned games don't accumulate.
- Use `state.setWebSocketAutoResponse()` for ping/pong so keepalives don't wake the object or
  count against duration.

## Cost sanity check

Free plan: 100,000 DO requests/day, 13,000 GB-s/day duration, with inbound WebSocket messages
billed at 20:1 against requests. A four-hour session for four players might generate a few
thousand messages — call it a couple of hundred billable requests — and the object hibernates
whenever nobody is clicking. There is no realistic path to a bill from private play. Storage for
SQLite-backed DOs began billing in January 2026, with free-plan daily limits on rows read and
written; a handful of rows per action stays inside them, which is another reason to snapshot
every 25 actions rather than every one.

## Local development

`@cloudflare/vite-plugin` runs the real Worker runtime and real Durable Objects under Miniflare
alongside Vite, so `npm run dev` gives you working multiplayer on `localhost` with no deploy. Test
with two browser windows (use a private window for the second so `localStorage` player IDs
differ). Test hibernation and reconnect deliberately: kill the network in devtools mid-turn, and
run a `wrangler dev` restart between two actions to force a rebuild from storage.

## Identity

No accounts. On first load the client generates a UUID into `localStorage` as `playerId` and asks
for a display name. Taking a seat binds `playerId` to that seat in the `seats` table; returning
with the same `playerId` reclaims it. Losing `localStorage` means asking the host to free the
seat — add a "release seat" control in the lobby for that case.

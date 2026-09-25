import { isRoomCode, roomCode, ROOM_CODE_LENGTH } from "@hb/protocol";

export { GameRoom } from "./room.ts";

// docs/04 "Routes". Everything else falls through to the built SPA.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);

    const match = /^\/api\/rooms\/([^/]+)(\/ws)?$/.exec(url.pathname);
    if (match) {
      const code = match[1]!.toUpperCase();
      if (!isRoomCode(code)) return new Response("no such room", { status: 404 });
      const room = env.GAME_ROOM.getByName(code);
      if (match[2]) return room.fetch(request);
      const meta = await room.roomMeta();
      return meta ? Response.json(meta) : new Response("no such room", { status: 404 });
    }
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { hands?: unknown } | null;
  const hands = body?.hands === "hidden" ? "hidden" : "open";
  // A collision is ~1 in 10^9 per room; retry a few times rather than never.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode(crypto.getRandomValues(new Uint32Array(ROOM_CODE_LENGTH)));
    if (await env.GAME_ROOM.getByName(code).init(code, hands)) return Response.json({ code }, { status: 201 });
  }
  return new Response("could not allocate a room code", { status: 503 });
}

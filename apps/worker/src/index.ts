import { DurableObject } from "cloudflare:workers";

// M0 hello world only. The real room protocol, seat claiming, redaction
// and reconnect handling land in M4 (docs/04-multiplayer.md).
export class GameRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ counter: await this.currentCounter() }));

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = JSON.parse(text) as { t?: string };
    if (parsed.t !== "increment") return;

    const counter = (await this.currentCounter()) + 1;
    await this.ctx.storage.put("counter", counter);

    const payload = JSON.stringify({ counter });
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  private async currentCounter(): Promise<number> {
    return (await this.ctx.storage.get<number>("counter")) ?? 0;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/api\/room\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const roomCode = match[1] as string;
      const id = env.GAME_ROOM.idFromName(roomCode);
      return env.GAME_ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

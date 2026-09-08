import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function getResponseWebSocket(response: Response): WebSocket {
  const socket = response.webSocket;
  if (!socket) throw new TypeError("expected a websocket response");
  return socket;
}

function nextMessage(socket: WebSocket): Promise<{ counter: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for a message")), 10_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        resolve(JSON.parse(event.data as string) as { counter: number });
      },
      { once: true },
    );
  });
}

async function connect(roomCode: string): Promise<WebSocket> {
  const id = env.GAME_ROOM.idFromName(roomCode);
  const stub = env.GAME_ROOM.get(id);
  const response = await stub.fetch("https://example.com/api/room/" + roomCode, {
    headers: { Upgrade: "websocket" },
  });
  const socket = getResponseWebSocket(response);
  socket.accept();
  return socket;
}

describe("GameRoom counter", () => {
  it("broadcasts an increment to every connected socket", async () => {
    const roomCode = `test-room-${crypto.randomUUID()}`;

    const a = await connect(roomCode);
    const helloA = await nextMessage(a);
    expect(helloA.counter).toBe(0);

    const b = await connect(roomCode);
    const helloB = await nextMessage(b);
    expect(helloB.counter).toBe(0);

    const nextA = nextMessage(a);
    const nextB = nextMessage(b);
    a.send(JSON.stringify({ t: "increment" }));

    expect(await nextA).toEqual({ counter: 1 });
    expect(await nextB).toEqual({ counter: 1 });

    a.close(1000, "done");
    b.close(1000, "done");
  });
});

import { useState } from "react";

// M0 hello world: connects to the GameRoom Durable Object over a
// hibernatable WebSocket, shows the shared counter, and can increment it.
// Real UI lands in M3 (docs/05-ui.md) driven entirely by view.pending.
export default function App() {
  const [counter, setCounter] = useState<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const connect = () => {
    const url = new URL("/api/room/hello", window.location.href);
    url.protocol = url.protocol.replace("http", "ws");
    const ws = new WebSocket(url);
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as { counter: number };
      setCounter(data.counter);
    });
    setSocket(ws);
  };

  const increment = () => {
    socket?.send(JSON.stringify({ t: "increment" }));
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
      <h1 className="text-2xl font-semibold">Hogwarts Battle</h1>
      {socket ? (
        <>
          <p className="text-4xl tabular-nums">{counter ?? "…"}</p>
          <button
            type="button"
            onClick={increment}
            className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500"
          >
            Increment
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="rounded bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600"
        >
          Connect
        </button>
      )}
    </main>
  );
}

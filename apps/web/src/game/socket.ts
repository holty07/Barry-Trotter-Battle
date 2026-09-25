import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, HeroId, LogEntry, PlayerView, SeatId, YearId } from "@hb/engine";
import type { ClientMessage, RoomMeta, ServerMessage } from "@hb/protocol";
import type { GameConnection } from "./connection.tsx";

// docs/04 "Identity": no accounts. A UUID in localStorage is who you are;
// losing it means asking someone to release your seat.
function stored(key: string, fallback: () => string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = fallback();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return fallback();
  }
}

export const playerId = () => stored("playerId", () => crypto.randomUUID());
export const savedName = () => stored("playerName", () => "");
export function saveName(name: string) {
  try {
    localStorage.setItem("playerName", name);
  } catch {
    // Private window: the name just won't be remembered.
  }
}

export type RoomStatus = "connecting" | "open" | "reconnecting" | "missing";

export type RoomSocket = {
  status: RoomStatus;
  room: RoomMeta | null;
  you: SeatId | null;
  error: string | null;
  connection: GameConnection | null; // once the game has started
  takeSeat: (seat: SeatId, heroId: HeroId) => void;
  releaseSeat: (seat: SeatId) => void;
  startGame: (year: YearId) => void;
};

type Game = { view: PlayerView; log: LogEntry[]; recent: LogEntry[]; version: number };

const wsUrl = (code: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rooms/${code}/ws`;

export function useRoomSocket(code: string, name: string): RoomSocket {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [you, setYou] = useState<SeatId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  // The last action sent. After a reconnect the welcome's lastSeq says
  // whether it landed; if not it's resent with the same seq, which the room
  // ignores if it did land after all (docs/04 idempotency).
  const outbox = useRef<Extract<ClientMessage, { t: "action" }> | null>(null);

  const post = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  const receive = useCallback(
    (message: ServerMessage) => {
      switch (message.t) {
        case "welcome":
          setError(null);
          setRoom(message.room);
          setYou(message.you);
          seq.current = Math.max(seq.current, message.lastSeq);
          if (outbox.current && outbox.current.seq > message.lastSeq) post(outbox.current);
          else outbox.current = null;
          return;
        case "view": {
          const prev = gameRef.current;
          const advanced = prev !== null && message.version > prev.version;
          if (advanced) setRejection(null);
          const recent = advanced ? message.log.slice(prev.log.length) : (prev?.recent ?? []);
          gameRef.current = { view: message.view, log: message.log, version: message.version, recent };
          setGame(gameRef.current);
          return;
        }
        case "rejected":
          if (outbox.current?.seq === message.seq) outbox.current = null;
          setRejection(message.reason);
          return;
        case "error":
          setError(message.message);
          return;
        case "pong":
          return;
      }
    },
    [post],
  );

  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      const ws = new WebSocket(wsUrl(code));
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        ws.send(JSON.stringify({ t: "hello", playerId: playerId(), name: nameRef.current } satisfies ClientMessage));
      };
      ws.onmessage = (event) => receive(JSON.parse(event.data as string) as ServerMessage);
      ws.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        timer = setTimeout(open, Math.min(500 * 2 ** retry++, 8000));
      };
    };

    // A bad code would otherwise retry forever.
    fetch(`/api/rooms/${code}`).then(
      (response) => {
        if (stopped) return;
        if (response.status === 404) setStatus("missing");
        else open();
      },
      () => !stopped && open(),
    );
    const keepalive = setInterval(() => post({ t: "ping" }), 30_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(keepalive);
      socket.current?.close();
    };
  }, [code, receive, post]);

  // Coming back to a backgrounded tab: ask for the latest rather than trust
  // a socket the OS may have quietly dropped.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && post({ t: "resync" });
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [post]);

  const send = useCallback(
    (action: Action) => {
      const message = { t: "action", seq: ++seq.current, action } as const;
      outbox.current = message;
      post(message);
    },
    [post],
  );

  const connection = useMemo<GameConnection | null>(
    () => (game ? { view: game.view, log: game.log, recent: game.recent, rejection, send } : null),
    [game, rejection, send],
  );

  return {
    status,
    room,
    you,
    error,
    connection,
    takeSeat: (seat, heroId) => post({ t: "takeSeat", seat, heroId }),
    releaseSeat: (seat) => post({ t: "releaseSeat", seat }),
    startGame: (year) => post({ t: "startGame", year }),
  };
}

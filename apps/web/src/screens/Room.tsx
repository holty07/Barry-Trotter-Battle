import { useState } from "react";
import type { ScenarioYearId } from "@hb/content/browser";
import { SEATS } from "@hb/protocol";
import { ConnectionProvider, useGame } from "../game/connection.tsx";
import type { ContentBundle } from "../game/content.ts";
import { saveName, savedName, useRoomSocket, type RoomSocket } from "../game/socket.ts";
import { End } from "./End.tsx";
import { TableScreen } from "./TableScreen.tsx";

// An online room (docs/04): lobby until the game starts, then the same Table
// the hot-seat game uses, fed from the socket instead of a local engine.
export function Room({ code, bundle, onHome }: { code: string; bundle: ContentBundle; onHome: () => void }) {
  const [name, setName] = useState(savedName);
  if (!name) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
        <h1 className="font-serif text-display font-semibold">Joining room {code}</h1>
        <NameForm
          onDone={(n) => {
            saveName(n);
            setName(n);
          }}
        />
      </main>
    );
  }
  return <ConnectedRoom code={code} name={name} bundle={bundle} onHome={onHome} />;
}

export function NameForm({ onDone }: { onDone: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="flex gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onDone(draft.trim());
      }}
    >
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-bone/70">Your name</span>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus className="rounded-md bg-panel px-3 py-2" />
      </label>
      <button type="submit" disabled={!draft.trim()} className="self-end rounded-md bg-bone px-5 py-2 font-semibold text-table disabled:opacity-40">
        Continue
      </button>
    </form>
  );
}

function ConnectedRoom({ code, name, bundle, onHome }: { code: string; name: string; bundle: ContentBundle; onHome: () => void }) {
  const socket = useRoomSocket(code, name);
  const [watching, setWatching] = useState(false);

  if (socket.status === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
        <h1 className="font-serif text-display font-semibold">No room called {code}</h1>
        <p className="text-bone/70">Check the code, or the room may have expired after 30 days without play.</p>
        <button type="button" onClick={onHome} className="self-start rounded-md bg-bone px-5 py-3 font-semibold text-table">
          Back to start
        </button>
      </main>
    );
  }

  const banner = socket.status === "reconnecting" && (
    <p role="status" className="fixed inset-x-0 top-0 z-50 bg-signal py-1 text-center text-bone">
      Connection lost — reconnecting…
    </p>
  );

  if (!socket.room) return <main className="flex min-h-dvh items-center justify-center text-bone/70">Connecting to room {code}…</main>;

  if (socket.connection && (socket.you || watching)) {
    return (
      <>
        {banner}
        <ConnectionProvider value={socket.connection}>
          <OnlineGame bundle={bundle} onHome={onHome} />
        </ConnectionProvider>
      </>
    );
  }

  return (
    <>
      {banner}
      <RoomLobby socket={socket} bundle={bundle} onWatch={() => setWatching(true)} onHome={onHome} />
    </>
  );
}

function OnlineGame({ bundle, onHome }: { bundle: ContentBundle; onHome: () => void }) {
  const { view } = useGame();
  return view.status === "playing" ? <TableScreen bundle={bundle} /> : <End bundle={bundle} onNextYear={null} onPlayAgain={null} onHome={onHome} />;
}

function RoomLobby({ socket, bundle, onWatch, onHome }: { socket: RoomSocket; bundle: ContentBundle; onWatch: () => void; onHome: () => void }) {
  const room = socket.room!;
  const [year, setYear] = useState<ScenarioYearId>(bundle.years[0]!);
  const heroes = bundle.heroesFor(year);
  const mine = room.seats.find((s) => s.seat === socket.you);
  const [heroId, setHeroId] = useState(mine?.heroId ?? "");
  const takenHeroes = new Set(room.seats.filter((s) => s.seat !== socket.you).map((s) => s.heroId));
  const link = `${location.origin}/r/${room.code}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-8">
      <div>
        <p className="text-bone/70">Room code</p>
        <h1 className="font-sans text-display font-semibold tracking-widest">{room.code}</h1>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="mt-1 text-bone/70 underline">
          Copy invite link
        </button>
      </div>

      {room.started ? (
        <section className="flex flex-col gap-3">
          <p className="text-bone/70">This game has started. Take back a free seat, or watch.</p>
          {room.seats
            .filter((s) => !s.taken)
            .map((s) => (
              <button key={s.seat} type="button" onClick={() => socket.takeSeat(s.seat, s.heroId)} className="self-start rounded-md bg-bone px-5 py-2 font-semibold text-table">
                Play as {bundle.heroName(s.heroId)}
              </button>
            ))}
          <button type="button" onClick={onWatch} className="self-start rounded-md border border-bone/30 px-5 py-2">
            Watch
          </button>
        </section>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-bone/70">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value) as ScenarioYearId)} className="rounded-md bg-panel px-3 py-2">
              {bundle.years.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-bone/70">Your hero</span>
            <select
              value={heroId}
              onChange={(e) => {
                setHeroId(e.target.value);
                if (mine && e.target.value) socket.takeSeat(mine.seat, e.target.value);
              }}
              className="rounded-md bg-panel px-3 py-2"
            >
              <option value="">Choose a hero</option>
              {heroes.map((h) => (
                <option key={h.heroId} value={h.heroId} disabled={takenHeroes.has(h.heroId)}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>

          <ul className="flex flex-col gap-2">
            {SEATS.map((seat, i) => {
              const row = room.seats.find((s) => s.seat === seat);
              return (
                <li key={seat} className="flex items-center gap-3 rounded-md bg-panel/60 px-3 py-2">
                  <span className="w-20 text-bone/70">Seat {i + 1}</span>
                  {row ? (
                    <>
                      <span className="flex-1">
                        {row.name ?? "Someone"} · {bundle.heroName(row.heroId)}
                      </span>
                      {/* docs/04: anyone can free a seat, for the player who lost their browser data. */}
                      <button type="button" onClick={() => socket.releaseSeat(seat)} className="text-bone/70 underline">
                        {seat === socket.you ? "Leave" : "Free seat"}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-bone/50">Empty</span>
                      <button
                        type="button"
                        disabled={!heroId || takenHeroes.has(heroId)}
                        onClick={() => socket.takeSeat(seat, heroId)}
                        className="rounded-md bg-bone px-3 py-1 font-semibold text-table disabled:opacity-40"
                      >
                        Sit here
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={!socket.you || room.seats.length < 2}
            onClick={() => socket.startGame(year)}
            className="self-start rounded-md bg-bone px-5 py-3 text-title font-semibold text-table disabled:opacity-40"
          >
            Start Year {year}
          </button>
          {room.seats.length < 2 && <p className="text-bone/50">Two to four players need a seat to start.</p>}
        </>
      )}

      {socket.error && <p className="font-semibold text-signal">{socket.error}</p>}
      <button type="button" onClick={onHome} className="self-start text-bone/70">
        Back to start
      </button>
    </main>
  );
}

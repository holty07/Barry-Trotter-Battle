import { useState } from "react";
import type { ContentIssue } from "@hb/content/browser";
import { isRoomCode } from "@hb/protocol";
import { saveName, savedName } from "../game/socket.ts";

export function Home({
  ready,
  issues,
  onPlayHere,
  onOpenRoom,
}: {
  ready: boolean;
  issues: ContentIssue[];
  onPlayHere: () => void;
  onOpenRoom: (code: string) => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="font-serif text-display font-semibold">Barry Trotter</h1>
      {ready ? (
        <>
          <p className="text-bone/70">A co-operative deck-builder for two to four heroes.</p>
          <OnlineRooms onOpenRoom={onOpenRoom} />
          <div className="border-t border-bone/10 pt-6">
            <button type="button" onClick={onPlayHere} className="rounded-md border border-bone/30 px-5 py-3 font-semibold">
              Play on this device
            </button>
          </div>
        </>
      ) : issues.length > 0 ? (
        <>
          <p className="font-semibold text-signal">Your card data has problems. Fix these in content/ and reload:</p>
          <ul className="max-h-[50dvh] list-disc overflow-y-auto pl-5 text-caption text-bone/80">
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.file}: {issue.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-bone/70">
          No card data found. Add your transcribed cards and year files to content/ (run <code>npm run content:check</code> to
          validate them), then restart the dev server.
        </p>
      )}
    </main>
  );
}

function OnlineRooms({ onOpenRoom }: { onOpenRoom: (code: string) => void }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState("");
  const [hiddenHands, setHiddenHands] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const named = name.trim().length > 0;
  const joinCode = code.trim().toUpperCase();

  const create = async () => {
    saveName(name.trim());
    setError(null);
    try {
      const response = await fetch("/api/rooms", { method: "POST", body: JSON.stringify({ hands: hiddenHands ? "hidden" : "open" }) });
      if (!response.ok) throw new Error(await response.text());
      onOpenRoom(((await response.json()) as { code: string }).code);
    } catch (err) {
      setError(`Couldn't create a room: ${(err as Error).message}`);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-bone/70">Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="rounded-md bg-panel px-3 py-2" />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={!named} onClick={() => void create()} className="rounded-md bg-bone px-5 py-3 text-title font-semibold text-table disabled:opacity-40">
          Create an online room
        </button>
        <label className="flex items-center gap-2 text-bone/70">
          <input type="checkbox" checked={hiddenHands} onChange={(e) => setHiddenHands(e.target.checked)} />
          Keep hands hidden
        </label>
      </div>
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          saveName(name.trim());
          onOpenRoom(joinCode);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Room code"
          aria-label="Room code"
          maxLength={6}
          className="w-36 rounded-md bg-panel px-3 py-2 font-semibold tracking-widest uppercase"
        />
        <button type="submit" disabled={!named || !isRoomCode(joinCode)} className="rounded-md border border-bone/30 px-5 py-2 font-semibold disabled:opacity-40">
          Join
        </button>
      </form>
      {error && <p className="text-signal">{error}</p>}
    </section>
  );
}

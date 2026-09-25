import { useState } from "react";
import type { ScenarioYearId } from "@hb/content/browser";
import type { ContentBundle } from "../game/content.ts";

export type LobbyChoice = { year: ScenarioYearId; heroes: string[] };

// Hot-seat lobby: year, number of seats, one hero per seat. Room code, seat
// claiming and hand visibility are online-room settings (M4).
export function Lobby({ bundle, onStart, onBack }: { bundle: ContentBundle; onStart: (choice: LobbyChoice) => void; onBack: () => void }) {
  const [year, setYear] = useState<ScenarioYearId>(bundle.years[0]!);
  const [seatCount, setSeatCount] = useState(2);
  const [heroes, setHeroes] = useState<string[]>([]);

  const options = bundle.heroesFor(year);
  const picked = Array.from({ length: seatCount }, (_, i) => heroes[i] ?? "");
  const ready = picked.every((h) => h !== "") && new Set(picked).size === seatCount;

  const pick = (seat: number, heroId: string) => setHeroes((prev) => Object.assign([...prev], { [seat]: heroId }));

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="font-serif text-display font-semibold">New game on this device</h1>

      <label className="flex flex-col gap-1">
        <span className="text-bone/70">Year</span>
        <select
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value) as ScenarioYearId);
            setHeroes([]);
          }}
          className="rounded-md bg-panel px-3 py-2"
        >
          {bundle.years.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-bone/70">Players</legend>
        <div className="flex gap-2">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={seatCount === n}
              onClick={() => setSeatCount(n)}
              className={`rounded-md px-4 py-2 font-semibold ${seatCount === n ? "bg-bone text-table" : "bg-panel"}`}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        {picked.map((heroId, seat) => (
          <label key={seat} className="flex items-center gap-3">
            <span className="w-20 text-bone/70">Player {seat + 1}</span>
            <select value={heroId} onChange={(e) => pick(seat, e.target.value)} className="flex-1 rounded-md bg-panel px-3 py-2">
              <option value="">Choose a hero</option>
              {options.map((o) => (
                <option key={o.heroId} value={o.heroId} disabled={picked.includes(o.heroId) && o.heroId !== heroId}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!ready}
          onClick={() => onStart({ year, heroes: picked })}
          className="rounded-md bg-bone px-5 py-3 text-title font-semibold text-table disabled:opacity-40"
        >
          Start Year {year}
        </button>
        <button type="button" onClick={onBack} className="rounded-md px-4 py-3 text-bone/70">
          Back
        </button>
      </div>
      {!ready && <p className="text-bone/50">Give each player a different hero to start.</p>}
    </main>
  );
}

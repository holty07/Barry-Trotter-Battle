import { useGame } from "../game/connection.tsx";
import type { ContentBundle } from "../game/content.ts";
import { logLine } from "../game/selectors.ts";

export function End({
  bundle,
  onNextYear,
  onPlayAgain,
  onHome,
}: {
  bundle: ContentBundle;
  onNextYear: (() => void) | null;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  const { view, log } = useGame();
  const won = view.status === "won";

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col gap-5 px-4 py-8">
      <h1 className={`font-serif text-display font-semibold ${won ? "" : "text-signal"}`}>
        {won ? `The heroes won Year ${view.year}` : `The villains won Year ${view.year}`}
      </h1>
      <p className="text-bone/70">
        {view.turn.number} turns · {view.villains.defeated.length} villains defeated
        {won ? "" : " · every location fell"}
      </p>
      <div className="flex flex-wrap gap-3">
        {won && onNextYear && (
          <button type="button" onClick={onNextYear} className="rounded-md bg-bone px-5 py-3 text-title font-semibold text-table">
            Play Year {view.year + 1} with the same heroes
          </button>
        )}
        <button type="button" onClick={onPlayAgain} className={`rounded-md px-5 py-3 font-semibold ${won && onNextYear ? "border border-bone/30" : "bg-bone text-title text-table"}`}>
          Play Year {view.year} again
        </button>
        <button type="button" onClick={onHome} className="rounded-md px-4 py-3 text-bone/70">
          Back to start
        </button>
      </div>
      <section aria-label="Game log" className="flex min-h-0 flex-1 flex-col">
        <h2 className="mb-2 font-serif text-title font-semibold">Game log</h2>
        <ol className="min-h-0 flex-1 overflow-y-auto rounded-md bg-panel/60 px-4 py-3 text-bone/80">
          {log.map((entry, i) => (
            <li key={i} className={entry.kind === "turnStarted" ? "mt-2 font-semibold text-bone first:mt-0" : ""}>
              {logLine(entry, view, bundle)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

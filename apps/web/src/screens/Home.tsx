import type { ContentIssue } from "@hb/content/browser";

export function Home({ ready, issues, onPlayHere }: { ready: boolean; issues: ContentIssue[]; onPlayHere: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="font-serif text-display font-semibold">Hogwarts Battle</h1>
      {ready ? (
        <>
          <p className="text-bone/70">A co-operative deck-builder for two to four heroes.</p>
          <button type="button" onClick={onPlayHere} className="self-start rounded-md bg-bone px-5 py-3 text-title font-semibold text-table">
            Play on this device
          </button>
          <p className="text-bone/50">Online rooms aren't available yet — pass the device around for now.</p>
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

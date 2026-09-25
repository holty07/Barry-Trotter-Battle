import { useEffect, useMemo, useState } from "react";
import { buildSetupInput, type ScenarioYearId } from "@hb/content/browser";
import { HotSeatProvider, useGame } from "./game/connection.tsx";
import { loadBundledContent, type ContentBundle } from "./game/content.ts";
import { End } from "./screens/End.tsx";
import { Home } from "./screens/Home.tsx";
import { Lobby, type LobbyChoice } from "./screens/Lobby.tsx";
import { Room } from "./screens/Room.tsx";
import { TableScreen } from "./screens/TableScreen.tsx";

type Screen = { name: "home" } | { name: "lobby" } | { name: "game"; choice: LobbyChoice; seed: number; key: number };

// Randomness lives here, never in the engine: the client picks a seed and
// the engine's seeded RNG does the rest (CLAUDE.md hard rule 1).
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

// Online rooms live at /r/<code>, so a reload or a shared link rejoins.
const roomFromPath = () => /^\/r\/([A-Za-z0-9]{6})$/.exec(location.pathname)?.[1]?.toUpperCase() ?? null;

function Game({ bundle, onNextYear, onPlayAgain, onHome }: { bundle: ContentBundle; onNextYear: (() => void) | null; onPlayAgain: () => void; onHome: () => void }) {
  const { view } = useGame();
  return view.status === "playing" ? (
    <TableScreen bundle={bundle} />
  ) : (
    <End bundle={bundle} onNextYear={onNextYear} onPlayAgain={onPlayAgain} onHome={onHome} />
  );
}

export default function App() {
  const { bundle, issues } = useMemo(loadBundledContent, []);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [roomCode, setRoomCode] = useState(roomFromPath);

  useEffect(() => {
    const onPop = () => setRoomCode(roomFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const openRoom = (code: string | null) => {
    history.pushState(null, "", code ? `/r/${code}` : "/");
    setRoomCode(code);
    setScreen({ name: "home" });
  };

  if (bundle && roomCode) return <Room key={roomCode} code={roomCode} bundle={bundle} onHome={() => openRoom(null)} />;
  if (!bundle || screen.name === "home") {
    return <Home ready={bundle !== null} issues={issues} onPlayHere={() => setScreen({ name: "lobby" })} onOpenRoom={openRoom} />;
  }
  if (screen.name === "lobby") {
    return <Lobby bundle={bundle} onStart={(choice) => setScreen({ name: "game", choice, seed: newSeed(), key: Date.now() })} onBack={() => setScreen({ name: "home" })} />;
  }

  const { choice } = screen;
  const startYear = (year: ScenarioYearId) => setScreen({ name: "game", choice: { ...choice, year }, seed: newSeed(), key: Date.now() });
  const nextYear = (choice.year + 1) as ScenarioYearId;
  const setupInput = buildSetupInput(bundle.content, {
    year: choice.year,
    seed: screen.seed,
    heroesBySeat: Object.fromEntries(choice.heroes.map((heroId, i) => [`seat-${i + 1}`, heroId])),
  });

  return (
    <HotSeatProvider key={screen.key} bundle={bundle} setupInput={setupInput}>
      <Game
        bundle={bundle}
        onNextYear={bundle.years.includes(nextYear) ? () => startYear(nextYear) : null}
        onPlayAgain={() => startYear(choice.year)}
        onHome={() => setScreen({ name: "home" })}
      />
    </HotSeatProvider>
  );
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { reduce, setup, viewFor, type Action, type GameState, type LogEntry, type PlayerView, type SetupInput } from "@hb/engine";
import type { ContentBundle } from "./content.ts";

// docs/05: one context for the connection and the current view; components
// read the view, they don't fetch. Hot-seat implements it by running the
// engine locally; M4's socket provider implements the same shape.
export type GameConnection = {
  view: PlayerView;
  log: LogEntry[];
  recent: LogEntry[]; // entries added by the latest accepted action
  rejection: string | null;
  send: (action: Action) => void;
};

const ConnectionContext = createContext<GameConnection | null>(null);

export function useGame(): GameConnection {
  const connection = useContext(ConnectionContext);
  if (!connection) throw new Error("useGame must be used inside a game provider");
  return connection;
}

// Hot-seat: every seat shares this screen, so the view is always for
// whoever the game needs next — the seat answering a prompt, else the
// active seat.
const actingSeat = (state: GameState) => state.pending?.seat ?? state.turn.activeSeat;

function startGame(input: SetupInput, bundle: ContentBundle): GameState {
  const initial = setup(input, bundle.catalog);
  const started = reduce(initial, { type: "advancePhase" }, { actingSeat: initial.turn.activeSeat, catalog: bundle.catalog });
  if (!started.ok) throw new Error(`could not start the game: ${started.reason}`);
  return started.state;
}

export function HotSeatProvider({ bundle, setupInput, children }: { bundle: ContentBundle; setupInput: SetupInput; children: ReactNode }) {
  const [state, setState] = useState(() => startGame(setupInput, bundle));
  const [recent, setRecent] = useState<LogEntry[]>(() => state.log);
  const [rejection, setRejection] = useState<string | null>(null);

  const send = useCallback(
    (action: Action) => {
      try {
        const result = reduce(state, action, { actingSeat: actingSeat(state), catalog: bundle.catalog });
        if (!result.ok) {
          setRejection(result.reason);
          return;
        }
        setRejection(null);
        setRecent(result.state.log.slice(state.log.length));
        setState(result.state);
      } catch (err) {
        // An effect the engine can't resolve throws with the card named
        // (docs/06 M2c "fail loudly") — show it rather than a blank screen.
        setRejection(`engine error: ${(err as Error).message}`);
      }
    },
    [state, bundle],
  );

  const view = useMemo(() => viewFor(actingSeat(state), state), [state]);
  const value = useMemo(() => ({ view, log: state.log, recent, rejection, send }), [view, state.log, recent, rejection, send]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

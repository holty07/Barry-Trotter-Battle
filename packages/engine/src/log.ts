import type { Action, GameState, LogEntry, SeatId } from "./types.ts";

// Derives log entries from one accepted action by comparing the state
// before and after it (including everything auto-advance ran). Kept in one
// place rather than threaded through every effect op. Everything logged is
// public information — no draws, no deck contents.
export function logEntriesFor(before: GameState, after: GameState, action: Action, seat: SeatId): LogEntry[] {
  const entries: LogEntry[] = [];
  const turnBefore = before.turn.number;
  const turnAfter = after.turn.number;

  if (action.type === "playCard") entries.push({ turn: turnBefore, kind: "cardPlayed", seat, cardId: action.cardId });
  if (action.type === "acquireCard") entries.push({ turn: turnBefore, kind: "cardAcquired", seat, cardId: action.cardId });
  if (action.type === "assignAttack") {
    const villain = before.villains.slots[action.villainSlot];
    entries.push({ turn: turnBefore, kind: "attackAssigned", seat, amount: action.amount, ...(villain ? { cardId: villain.cardId } : {}) });
  }

  for (const cardId of after.villains.defeated.slice(before.villains.defeated.length)) {
    entries.push({ turn: turnBefore, kind: "villainDefeated", seat, cardId });
  }

  const gameStarting = before.phase === "turnStart";
  if (gameStarting) entries.push({ turn: turnBefore, kind: "turnStarted", seat: before.turn.activeSeat });
  if (turnAfter !== turnBefore) entries.push({ turn: turnAfter, kind: "turnStarted", seat: after.turn.activeSeat });

  const newReveal = turnAfter !== turnBefore || gameStarting;
  if (newReveal) {
    for (const cardId of after.darkArts.revealedThisTurn) entries.push({ turn: turnAfter, kind: "darkArtsRevealed", cardId });
  }

  const beforeLoc = before.locations;
  const afterLoc = after.locations;
  for (let i = beforeLoc.current; i < afterLoc.current; i++) {
    const cardId = beforeLoc.order[i];
    entries.push({ turn: turnAfter, kind: "locationLost", ...(cardId ? { cardId } : {}) });
  }
  if (afterLoc.current === beforeLoc.current) {
    const delta = afterLoc.controlTokens - beforeLoc.controlTokens;
    if (delta > 0) entries.push({ turn: turnAfter, kind: "controlAdded", amount: delta });
    if (delta < 0) entries.push({ turn: turnAfter, kind: "controlRemoved", amount: -delta });
  }

  for (const s of after.seats) {
    if (after.players[s]!.stunned && !before.players[s]!.stunned) entries.push({ turn: turnAfter, kind: "heroStunned", seat: s });
  }

  if (after.status === "won" && before.status !== "won") entries.push({ turn: turnAfter, kind: "gameWon" });
  if (after.status === "lost" && before.status !== "lost") entries.push({ turn: turnAfter, kind: "gameLost" });

  return entries;
}

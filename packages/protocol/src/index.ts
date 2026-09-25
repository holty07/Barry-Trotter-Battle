/**
 * Wire types shared between the client and the GameRoom Durable Object —
 * docs/04-multiplayer.md "Wire protocol". Discriminate on `t`.
 */
import type { Action, HandVisibility, HeroId, LogEntry, PlayerView, RejectReason, SeatId, YearId } from "@hb/engine";

// Additions to docs/04's union, all plumbing rather than rules:
//  - `welcome.lastSeq`: the highest `seq` the room has applied for your
//    seat, so a client that lost its counter (new tab, same playerId) or
//    dropped mid-send knows where to resume and whether to resend.
//  - `releaseSeat`: the lobby control docs/04 "Identity" asks for, for a
//    player who lost their localStorage.
//  - `pong`: the fixed auto-response to `ping` (setWebSocketAutoResponse).

export type ClientMessage =
  | { t: "hello"; playerId: string; name: string; lastSeq?: number }
  | { t: "takeSeat"; seat: SeatId; heroId: HeroId }
  | { t: "releaseSeat"; seat: SeatId }
  | { t: "startGame"; year: YearId }
  | { t: "action"; seq: number; action: Action }
  | { t: "resync" }
  | { t: "ping" };

export type SeatInfo = { seat: SeatId; name: string | null; heroId: HeroId; taken: boolean };

export type RoomMeta = {
  code: string;
  hands: HandVisibility;
  year: YearId | null; // set when the game starts
  started: boolean;
  seats: SeatInfo[]; // claimed or in-game seats only, in seat order
};

export type ServerMessage =
  | { t: "welcome"; you: SeatId | null; lastSeq: number; room: RoomMeta }
  | { t: "view"; version: number; view: PlayerView; log: LogEntry[] }
  | { t: "rejected"; seq: number; reason: RejectReason }
  | { t: "error"; message: string }
  | { t: "pong" };

export const PING = JSON.stringify({ t: "ping" } satisfies ClientMessage);
export const PONG = JSON.stringify({ t: "pong" } satisfies ServerMessage);

export const SEATS: readonly SeatId[] = ["seat-1", "seat-2", "seat-3", "seat-4"];

// docs/04 "Room codes": no O/0/I/1/L. Obscurity, not authentication.
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/** `randomValues` is injected so this stays deterministic under test. */
export function roomCode(randomValues: Uint32Array): string {
  return Array.from(randomValues.subarray(0, ROOM_CODE_LENGTH), (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join("");
}

export const isRoomCode = (code: string): boolean => new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code);

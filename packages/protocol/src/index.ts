/**
 * Wire types shared between the client and the GameRoom Durable Object.
 * Filled in properly in M4 (docs/04-multiplayer.md). M0 just needs the
 * package to exist and be importable so the workspace graph is real.
 */

export interface HelloMessage {
  readonly t: "hello";
  readonly counter: number;
}

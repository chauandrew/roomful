/**
 * Wire protocol between clients (host + players) and the PartyKit room server.
 * Shared by both sides — no React / PartyKit imports here.
 */
import type { ClientView } from "./types";

/** Host control actions. `game` wraps game-specific actions untouched. */
export type HostAction =
  | { kind: "start" }
  | { kind: "restart" } // back to lobby, keeping players
  | { kind: "end" }
  | { kind: "kick"; playerId: string }
  | { kind: "game"; action: unknown };

export type ClientMessage =
  /**
   * Sent by the host page right after connecting. Creates the room if it
   * doesn't exist. `hostKey` is a client-generated secret persisted in
   * sessionStorage so a refreshed host tab can reclaim its room.
   */
  | { type: "claim-host"; gameId: string; hostKey: string }
  /**
   * Sent by a player page. `playerId` is client-generated and persisted in
   * sessionStorage so a refreshed phone reclaims its seat mid-game.
   */
  | { type: "join"; playerId: string; name: string }
  | { type: "host-action"; action: HostAction }
  | { type: "player-input"; input: unknown };

export type RoomErrorCode =
  | "room-not-found"
  | "room-taken"
  | "room-full"
  | "game-started"
  | "unknown-game"
  | "not-allowed"
  | "bad-message";

export type ServerMessage =
  | { type: "sync"; view: ClientView }
  | { type: "error"; code: RoomErrorCode; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.type === "string") return msg as ClientMessage;
  } catch {
    // fall through
  }
  return null;
}

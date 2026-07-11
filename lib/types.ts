/**
 * Core shared types for Roomful.
 *
 * These are imported by BOTH the Next.js app and the PartyKit room server,
 * so keep this file free of React / DOM / PartyKit imports.
 */

export type GameMode = "single-device" | "multi-user";

/** Static metadata every game declares. Lives in games/<id>/meta.ts. */
export interface GameMeta {
  /** URL-safe unique id, e.g. "sketch-chain". Used in routes and registries. */
  id: string;
  name: string;
  description: string;
  mode: GameMode;
  minPlayers: number;
  maxPlayers: number;
  /** Rough duration shown on the homepage card, in minutes. */
  durationMinutes: number;
  /** Accent color (hex) applied to this game's screens via the --accent CSS var. */
  accent: string;
}

export interface Player {
  id: string;
  name: string;
  /** Optional team/role, assigned by a game's logic (e.g. "red" / "spymaster"). */
  team?: string;
  role?: string;
  connected: boolean;
}

/**
 * Platform-level room lifecycle. Games define their own internal phases
 * inside their game state; the platform only tracks these three.
 */
export type RoomPhase = "lobby" | "playing" | "ended";

/** Full authoritative room state. Lives only in the PartyKit room server. */
export interface RoomState<S = unknown> {
  code: string;
  gameId: string;
  phase: RoomPhase;
  players: Player[];
  /** Game-defined state, produced by the game's server logic. Null in lobby. */
  game: S | null;
}

/**
 * What a single client (host or player) is allowed to see.
 * `game` is a personalized projection: hostView() for the host,
 * playerView(playerId) for each player — never the raw authoritative state.
 */
export interface ClientView {
  code: string;
  gameId: string;
  phase: RoomPhase;
  players: Player[];
  isHost: boolean;
  /** Present for players only: their own identity (incl. team/role). */
  you?: Pick<Player, "id" | "name" | "team" | "role">;
  game: unknown;
}

/**
 * The interfaces every game implements. This is the plugin contract:
 * a game is (1) a GameMeta, (2) client components, and — for multi-user
 * games — (3) a MultiUserGameLogic reducer registered in
 * games/server-registry.ts.
 *
 * Server logic files must stay free of React/DOM imports: they are bundled
 * into the PartyKit worker. Keep them pure functions so they're trivially
 * unit-testable.
 */
import type { Player } from "../lib/types";

/**
 * Server-side logic for a multi-user game. Runs inside the PartyKit room.
 *
 * All methods are pure: they receive the current game state and return the
 * next one (returning the same reference is fine when nothing changed).
 * The platform handles the lobby, player identity, reconnection, and
 * broadcasting — a game only describes how its state evolves and what each
 * screen is allowed to see.
 *
 * S      — the game's authoritative state shape (anything serializable)
 * HostA  — actions the host's control UI can send (via sendGameAction)
 * Input  — inputs a player's phone can send (via sendInput)
 */
export interface MultiUserGameLogic<S = unknown, HostA = unknown, Input = unknown> {
  /**
   * Build the initial game state when the host presses Start.
   * This is where a game assigns teams/roles: mutate nothing — return state,
   * and set player.team / player.role via the optional `assignPlayers` hook.
   */
  init(players: Player[]): S;

  /**
   * Optionally assign team/role to each player at game start (e.g. split
   * into red/blue, pick a spymaster). Return a map of playerId → patch.
   */
  assignPlayers?(players: Player[]): Record<string, Pick<Player, "team" | "role">>;

  /** Handle a host control action (reveal, next round, …). */
  onHostAction(state: S, action: HostA, players: Player[]): S;

  /** Handle one player's submitted input. */
  onPlayerInput(state: S, playerId: string, input: Input, players: Player[]): S;

  /**
   * Projection for the projector screen. Include only what the whole room
   * may see — private info belongs in playerView.
   */
  hostView(state: S, players: Player[]): unknown;

  /**
   * Personalized projection for one player. This single hook is what makes
   * asymmetric games work: private prompts (sketch-chain), role-restricted
   * info (spymaster), or just "you've submitted, wait".
   */
  playerView(state: S, playerId: string, players: Player[]): unknown;
}

/**
 * Helper for sequential/chain rounds (Gartic-Phone-style relays).
 *
 * With n players there are n chains. At step k, chain c is worked on by
 * player (c + k) mod n — so every chain visits every player exactly once
 * over n steps, and nobody ever gets their own chain back before the end.
 *
 * Returns, for the given step, a map of playerId → chain index to work on.
 */
export function chainAssignments(playerIds: string[], step: number): Record<string, number> {
  const n = playerIds.length;
  const assignments: Record<string, number> = {};
  for (let chain = 0; chain < n; chain++) {
    assignments[playerIds[(chain + step) % n]] = chain;
  }
  return assignments;
}

/** True once every listed player id appears as a key of `submissions`. */
export function allSubmitted(
  playerIds: string[],
  submissions: Record<string, unknown>
): boolean {
  return playerIds.every((id) => id in submissions);
}

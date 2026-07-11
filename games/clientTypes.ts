/**
 * Prop contracts for the components a game exports.
 *
 * Single-device games export one component (Play) rendered at /play/[gameId].
 * Multi-user games export two: HostView (the projector, at /host/[gameId])
 * and PlayerView (the phone, at /join/[roomCode]). The platform renders the
 * lobby, join flow, and end screen — game components only handle the
 * "playing" phase.
 *
 * `view.game` holds whatever the game's hostView()/playerView() projection
 * returned on the server; each game casts it to its own view type.
 */
import type { ClientView } from "@/lib/types";
import type { HostAction } from "@/lib/protocol";

export interface HostViewProps {
  view: ClientView;
  /** Send a game-defined action to the game's onHostAction reducer. */
  sendGameAction: (action: unknown) => void;
  /** Platform actions: restart / end / kick. */
  sendHostAction: (action: HostAction) => void;
}

export interface PlayerViewProps {
  view: ClientView;
  /** Submit input to the game's onPlayerInput reducer. */
  sendInput: (input: unknown) => void;
}

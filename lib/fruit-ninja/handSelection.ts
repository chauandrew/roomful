/**
 * Filters out hands too small to plausibly be a player's — MediaPipe's
 * numHands cap doesn't know which candidates are players and which are a
 * background person, and a background hand reads smaller in frame the
 * farther back it is. Hand span (wrist to middle-finger knuckle, landmarks 0
 * and 9) is a cheap distance proxy computed from geometry the model already
 * gives us — the same shortcut HomeCourt takes sampling torso color instead
 * of running a second network.
 *
 * This is an absolute floor, not "keep the N largest": fruit-ninja is a
 * fixed 2-player co-op game (up to 4 legitimate hands), so there's no safe
 * assumption about how many detected hands are real players vs. background —
 * a relative top-N cutoff would silently drop a real second player's hand
 * whenever a background hand happened to be closer than them.
 */
import type { Landmark } from "@/lib/tracking/types";

const WRIST = 0;
const MIDDLE_MCP = 9;
export const INDEX_FINGERTIP = 8;

// Normalized units, aspect-corrected. Was 0.12 (an unmeasured guess that
// conflated palm length with full hand length). A real recording via
// games/fruit-ninja/replay-recording.ts showed actual player-hand spans
// running 0.08 (arm's length from camera) to 0.17 (close) — 0.12 was
// rejecting the player's own hand at anything but close range, which
// replay-recording.ts's "MIN_HAND_SPAN filter impact" section showed
// accounted for the majority of apparent dropout in that session, not
// MediaPipe actually failing. Lowered well below the observed far-range
// floor so it stops rejecting real players; this weakens the background-
// person rejection it exists for, but there's no real measurement yet of
// what a background hand's span looks like in practice, and a demonstrated
// harm beats a hypothetical one. Retune both directions once that exists.
export const MIN_HAND_SPAN = 0.03;

export function handSpan(landmarks: Landmark[], aspect: number): number {
  const wrist = landmarks[WRIST];
  const mcp = landmarks[MIDDLE_MCP];
  if (!wrist || !mcp) return 0;
  return Math.hypot((wrist.x - mcp.x) * aspect, wrist.y - mcp.y);
}

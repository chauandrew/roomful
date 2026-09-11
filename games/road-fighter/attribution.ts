/**
 * Assigns each frame's (up to 2) detected poses to Player 1 (left half of
 * frame) or Player 2 (right half), filtering out anything too small/far to
 * plausibly be one of the two actual players — same idea as
 * lib/fruit-ninja/handSelection.ts's handSpan/MIN_HAND_SPAN filter, and see
 * that file's comment block for why this is an absolute floor rather than
 * "keep the top N by size".
 *
 * Assignment itself uses an absolute frame-midline test (x = 0.5) as the
 * fallback — a midline test still works when only one player is currently
 * detected, whereas sorting two detections against each other breaks down
 * the moment there's only one — but within CONFIG.MIDLINE_DEADZONE of that
 * line, `PlayerAttributor` sticks with whichever player a detection was
 * closest to last frame instead of re-deciding from the raw x position, same
 * idea as fruit-ninja-duel's sticky midline attribution (see its
 * MIDLINE_DEADZONE / lib/fruit-ninja/handTracker.ts's sideOf). Without that,
 * a player standing near center — or ordinary landmark jitter on anyone
 * whose hip center happens to sit near x=0.5 — can flip player1/player2 from
 * frame to frame.
 */
import type { Landmark } from "@/lib/tracking/types";
import { CONFIG } from "./config";

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;

export function poseSpan(landmarks: Landmark[], aspect: number): number {
  const lSh = landmarks[L_SHOULDER];
  const rSh = landmarks[R_SHOULDER];
  const lHip = landmarks[L_HIP];
  const rHip = landmarks[R_HIP];
  if (!lSh || !rSh || !lHip || !rHip) return 0;
  const shoulderX = (lSh.x + rSh.x) / 2;
  const shoulderY = (lSh.y + rSh.y) / 2;
  const hipX = (lHip.x + rHip.x) / 2;
  const hipY = (lHip.y + rHip.y) / 2;
  return Math.hypot((shoulderX - hipX) * aspect, shoulderY - hipY);
}

/**
 * MediaPipe runs on the raw, unmirrored video frame, but Play.tsx draws
 * everything (video + skeletons) through drawMirroredVideoFrame/
 * drawSkeleton's translate(width,0)+scale(-1,1) transform so it reads like a
 * real mirror. Un-mirror x here (1 - x) so "left"/"right" mean the same
 * halves the player actually sees on screen — same trick chomp-chomp's
 * face-cursor uses for the same reason.
 */
function hipCenterX(landmarks: Landmark[]): number {
  const lHip = landmarks[L_HIP];
  const rHip = landmarks[R_HIP];
  return 1 - (lHip.x + rHip.x) / 2;
}

/**
 * Stateful across frames (unlike a bare function) so it can remember each
 * player's last known position for the midline deadzone above — construct
 * one instance per match/tutorial session, alongside the two
 * PoseFighterDetectors, and call `attribute()` once per frame.
 */
export class PlayerAttributor {
  private lastX: [number | null, number | null] = [null, null];

  attribute(landmarksList: Landmark[][], aspect: number): [Landmark[] | null, Landmark[] | null] {
    const result: [Landmark[] | null, Landmark[] | null] = [null, null];
    const resultSpan: [number, number] = [-Infinity, -Infinity];

    for (const landmarks of landmarksList) {
      const span = poseSpan(landmarks, aspect);
      if (span < CONFIG.MIN_POSE_SPAN) continue;

      const slot = this.assignSlot(hipCenterX(landmarks));
      if (span > resultSpan[slot]) {
        result[slot] = landmarks;
        resultSpan[slot] = span;
      }
    }

    if (result[0]) this.lastX[0] = hipCenterX(result[0]);
    if (result[1]) this.lastX[1] = hipCenterX(result[1]);

    return result;
  }

  /** Clears position memory — call when a match/tutorial session restarts. */
  reset() {
    this.lastX = [null, null];
  }

  private assignSlot(x: number): 0 | 1 {
    if (Math.abs(x - 0.5) <= CONFIG.MIDLINE_DEADZONE) {
      const [last0, last1] = this.lastX;
      if (last0 !== null || last1 !== null) {
        const d0 = last0 === null ? Infinity : Math.abs(x - last0);
        const d1 = last1 === null ? Infinity : Math.abs(x - last1);
        return d0 <= d1 ? 0 : 1;
      }
    }
    return x < 0.5 ? 0 : 1;
  }
}

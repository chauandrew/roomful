/**
 * Assigns each frame's (up to 2) detected poses to Player 1 (left half of
 * frame) or Player 2 (right half), filtering out anything too small/far to
 * plausibly be one of the two actual players — same idea as
 * lib/fruit-ninja/handSelection.ts's handSpan/MIN_HAND_SPAN filter, and see
 * that file's comment block for why this is an absolute floor rather than
 * "keep the top N by size".
 *
 * Assignment itself uses an absolute frame-midline test (x = 0.5), not a
 * relative left/right sort between whatever detections happen to exist this
 * frame — a midline test still works when only one player is currently
 * detected, whereas sorting two detections against each other breaks down
 * the moment there's only one.
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

export function attributePlayers(
  landmarksList: Landmark[][],
  aspect: number,
): [Landmark[] | null, Landmark[] | null] {
  let player1: Landmark[] | null = null;
  let player1Span = -Infinity;
  let player2: Landmark[] | null = null;
  let player2Span = -Infinity;

  for (const landmarks of landmarksList) {
    const span = poseSpan(landmarks, aspect);
    if (span < CONFIG.MIN_POSE_SPAN) continue;

    const lHip = landmarks[L_HIP];
    const rHip = landmarks[R_HIP];
    // MediaPipe runs on the raw, unmirrored video frame, but Play.tsx draws
    // everything (video + skeletons) through drawMirroredVideoFrame/
    // drawSkeleton's translate(width,0)+scale(-1,1) transform so it reads
    // like a real mirror. Un-mirror x here (1 - x) so "left"/"right" below
    // mean the same halves the player actually sees on screen — same trick
    // chomp-chomp's face-cursor uses for the same reason.
    const hipCenterX = 1 - (lHip.x + rHip.x) / 2;

    if (hipCenterX < 0.5) {
      if (span > player1Span) {
        player1 = landmarks;
        player1Span = span;
      }
    } else {
      if (span > player2Span) {
        player2 = landmarks;
        player2Span = span;
      }
    }
  }

  return [player1, player2];
}

/**
 * Records MediaPipe's raw hand-detection output during a real play session —
 * full 21-point landmarks per hand, before MIN_HAND_SPAN or fingertip
 * extraction discard anything — so a downloaded recording can answer
 * questions raw fingertip-only data can't: is a dropout MediaPipe finding
 * nothing, or MIN_HAND_SPAN rejecting a real hand? Does span (distance from
 * camera) or landmark z-spread (hand rotated away from the camera) predict
 * dropouts? See replay-recording.ts. Dev tool only — see the "Download hand
 * recording" button gated behind process.env.NODE_ENV in Play.tsx.
 */
import { Recorder } from "@/lib/tracking/recorder";
import type { Landmark } from "@/lib/tracking/types";

export interface RawHandSample {
  landmarks: Landmark[];
  handedness?: string;
}

export class HandRecorder extends Recorder<RawHandSample[]> {
  download(filename = `fruit-ninja-recording-${Date.now()}.json`) {
    super.download(filename);
  }
}

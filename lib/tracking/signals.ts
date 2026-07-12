import type { Landmark } from "./types";

/** Fixed-length moving average. */
export class MovingAverage {
  private size: number;
  private buf: number[] = [];

  constructor(size: number) {
    this.size = size;
  }

  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    let s = 0;
    for (const x of this.buf) s += x;
    return s / this.buf.length;
  }

  reset() {
    this.buf = [];
  }
}

/**
 * True when every landmark at `requiredIndices` has visibility >= threshold.
 * Generalizes floss-rush's hardcoded 6-landmark-index check so other
 * tracking games can gate on whichever joints they need.
 */
export function isVisible(
  landmarks: Landmark[] | undefined | null,
  requiredIndices: number[],
  threshold: number
): boolean {
  if (!landmarks) return false;
  return requiredIndices.every((i) => (landmarks[i]?.visibility ?? 0) >= threshold);
}

// FaceLandmarker's mouth/eye-corner indices, standard MediaPipe FaceMesh topology.
const UPPER_INNER_LIP = 13;
const LOWER_INNER_LIP = 14;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

/**
 * Raw mouth-open ratio: vertical gap between the inner lips, normalized by
 * inter-eye distance so it's independent of how close the face is to the
 * camera. Pure and unsmoothed — callers (e.g. a game's detector) should run
 * this through a MovingAverage themselves.
 */
export function mouthOpenRatio(landmarks: Landmark[]): number {
  const upperLip = landmarks[UPPER_INNER_LIP];
  const lowerLip = landmarks[LOWER_INNER_LIP];
  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  if (eyeDist === 0) return 0;
  return Math.abs(upperLip.y - lowerLip.y) / eyeDist;
}

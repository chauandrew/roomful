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

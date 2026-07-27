/** Tiny shared math helpers used by both physics.ts and draw.ts. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Chomp Chomp — pure game logic: face landmark indices, the dot grid,
 * calibration math, and eat detection. No canvas/React here (see draw.ts
 * for rendering, Play.tsx for the state machine).
 */
import { isVisible } from "@/lib/tracking/signals";
import type { Landmark } from "@/lib/tracking/types";
import { CONFIG } from "./config";

// FaceLandmarker landmark indices (standard MediaPipe FaceMesh topology).
export const NOSE_TIP = 1;
const REQUIRED_INDICES = [NOSE_TIP, 13, 14, 33, 263];

/**
 * Face-lost detection. FaceLandmarker (unlike PoseLandmarker) doesn't
 * populate a meaningful per-landmark visibility score, so this only checks
 * that landmarks exist at the indices we need — threshold 0 makes
 * `isVisible` degenerate to a presence check, which is all we can rely on here.
 */
export function isFaceVisible(landmarks: Landmark[] | undefined | null): boolean {
  return isVisible(landmarks, REQUIRED_INDICES, 0);
}

export interface Dot {
  x: number;
  y: number;
  eaten: boolean;
}

/** Generates a fixed cols x rows grid of dots inside a margin, once per round. */
export function generateDots(canvasWidth: number, canvasHeight: number): Dot[] {
  const { DOT_GRID_COLS: cols, DOT_GRID_ROWS: rows, DOT_MARGIN_FRACTION: margin } = CONFIG;
  const marginX = canvasWidth * margin;
  const marginY = canvasHeight * margin;
  const usableW = canvasWidth - marginX * 2;
  const usableH = canvasHeight - marginY * 2;

  const dots: Dot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = marginX + (cols === 1 ? usableW / 2 : (usableW * col) / (cols - 1));
      const y = marginY + (rows === 1 ? usableH / 2 : (usableH * row) / (rows - 1));
      dots.push({ x, y, eaten: false });
    }
  }
  return dots;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Midpoint-ish open threshold between calibrated min/max mouth ratios.
 * Returns null when the range is too small to trust (calibration failed).
 */
export function computeOpenThreshold(minRatio: number, maxRatio: number): number | null {
  const range = maxRatio - minRatio;
  if (range < CONFIG.MIN_MOUTH_RANGE) return null;
  return minRatio + CONFIG.OPEN_THRESHOLD_FRACTION * range;
}

/** Maps a mouth ratio to the wedge's total gap half-angle, in radians, clamped to [min, max]. */
export function wedgeHalfAngleRad(mouthRatio: number, minRatio: number, maxRatio: number): number {
  const range = maxRatio - minRatio;
  const t = range > 0 ? clamp((mouthRatio - minRatio) / range, 0, 1) : 0;
  const angleDeg = CONFIG.WEDGE_MIN_ANGLE_DEG + t * (CONFIG.WEDGE_MAX_ANGLE_DEG - CONFIG.WEDGE_MIN_ANGLE_DEG);
  return (angleDeg * Math.PI) / 180 / 2;
}

/**
 * Eats at most one not-yet-eaten dot within `hitRadius` of the cursor, and
 * only when the mouth is open AND the caller says a dot can still be eaten
 * this "open episode" (`canEat` — false once one dot has already been eaten
 * since the mouth last opened, until it closes and reopens). Mutates `dots`
 * in place (they live in a ref, not React state) and returns 1 if a dot was
 * eaten, 0 otherwise.
 */
export function tryEatDots(
  dots: Dot[],
  cursor: { x: number; y: number },
  mouthOpen: boolean,
  canEat: boolean
): number {
  if (!mouthOpen || !canEat) return 0;
  const r2 = CONFIG.DOT_HIT_RADIUS * CONFIG.DOT_HIT_RADIUS;
  for (const dot of dots) {
    if (dot.eaten) continue;
    const dx = dot.x - cursor.x;
    const dy = dot.y - cursor.y;
    if (dx * dx + dy * dy <= r2) {
      dot.eaten = true;
      return 1;
    }
  }
  return 0;
}

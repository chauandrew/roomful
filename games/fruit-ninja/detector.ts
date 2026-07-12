/**
 * Slice detection: which entities did a hand's motion cut this frame?
 *
 * A slice is the line segment between two consecutive points of the same
 * hand's motion intersecting an entity's hit-circle. Only segments traversed
 * since the previous frame (`sinceT`) are tested — older trail segments are
 * history, and a fruit drifting into a stale trail must not count as cut.
 * For a slot mid-dropout the tested segment runs between its dead-reckoned
 * positions at `sinceT` and `now`, so a briefly-undetected swipe keeps
 * slicing instead of teleporting. Pure functions, no React/canvas.
 */
import { CONFIG } from "./config";
import { predictPosition, type HandTrackerState } from "./handTracker";
import type { Entity } from "./physics";

export interface SliceResult {
  slicedFruit: Entity[];
  slicedBombs: Entity[];
  comboBonus: number;
}

type Segment = [number, number, number, number]; // ax, ay, bx, by

/**
 * Point-segment distance test in screen-height units: x deltas are scaled by
 * `aspect` (width/height) so the hit-circle is a true circle on screen, not
 * an ellipse stretched by the normalized coordinate space.
 */
function segmentHitsCircle(seg: Segment, cx: number, cy: number, r: number, aspect: number): boolean {
  const [ax, ay, bx, by] = seg;
  const sx = (bx - ax) * aspect;
  const sy = by - ay;
  const px = (cx - ax) * aspect;
  const py = cy - ay;
  const len2 = sx * sx + sy * sy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * sx + py * sy) / len2));
  const dx = px - t * sx;
  const dy = py - t * sy;
  return dx * dx + dy * dy <= r * r;
}

export function detectSlices(
  state: HandTrackerState,
  entities: Entity[],
  now: number,
  sinceT: number,
  aspect: number
): SliceResult {
  const slicedIds = new Set<number>();
  const slicedFruit: Entity[] = [];
  const slicedBombs: Entity[] = [];
  let comboBonus = 0;

  for (const slot of state) {
    if (!slot.active || slot.trail.length === 0) continue;

    const segs: Segment[] = [];
    for (let i = 1; i < slot.trail.length; i++) {
      const a = slot.trail[i - 1];
      const b = slot.trail[i];
      if (b.t > sinceT) segs.push([a.x, a.y, b.x, b.y]);
    }
    if (slot.sawGap) {
      const last = slot.trail[slot.trail.length - 1];
      const a = predictPosition(slot, Math.max(sinceT, last.t));
      const b = predictPosition(slot, now);
      if (a && b) segs.push([a.x, a.y, b.x, b.y]);
    }
    if (segs.length === 0) continue;

    let fruitThisStroke = 0;
    for (const e of entities) {
      if (slicedIds.has(e.id)) continue; // one cut per entity, even across hands
      for (const seg of segs) {
        if (!segmentHitsCircle(seg, e.x, e.y, e.radius, aspect)) continue;
        slicedIds.add(e.id);
        if (e.kind === "fruit") {
          slicedFruit.push(e);
          fruitThisStroke++;
        } else {
          slicedBombs.push(e);
        }
        break;
      }
    }
    if (CONFIG.COMBO_ENABLED && fruitThisStroke > 1) {
      comboBonus += (fruitThisStroke - 1) * CONFIG.COMBO_BONUS;
    }
  }

  return { slicedFruit, slicedBombs, comboBonus };
}

/**
 * Persistent hand-slot tracking.
 *
 * MediaPipe's HandLandmarker gives no stable hand identity across frames, and
 * a fast swing can drop detections entirely for a frame or two mid-motion.
 * Each frame's detections are matched to slots seen recently enough
 * (MAX_GAP_MS). Each slot keeps a smoothed velocity estimate, and matching is
 * done against the slot's *predicted* position (last point + velocity * gap):
 * a fast swipe travels real distance while undetected, so matching against
 * the stale last position would reject the reappearance and open a spurious
 * new slot (the "teleport"). Slots with no velocity yet fall back to plain
 * distance-to-last-point within MAX_MATCH_DISTANCE. No synthetic trail
 * points are fabricated — the trail simply keeps
 * the real points on both sides of the gap, and the straight segment between
 * them is exactly what a segment-intersection slice check needs. Points that
 * follow a gap are marked `bridged` so a renderer can show where bridging
 * happened.
 */
import { CONFIG } from "./config";

export interface HandDetection {
  x: number;
  y: number;
  handedness?: string;
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  bridged: boolean; // this point followed one or more dropped frames on this slot
}

export interface HandSlot {
  active: boolean;
  trail: TrailPoint[];
  lastSeen: number;
  sawGap: boolean; // slot went unmatched since its last trail point
  handedness?: string;
  vx?: number; // smoothed velocity, normalized units per ms (undefined until 2 points)
  vy?: number;
}

export type HandTrackerState = HandSlot[];

const MAX_SLOTS = 4;
// Below this speed (normalized units/ms) direction is mostly jitter, so the
// trajectory tie-breaker stays out of it.
const MIN_TIEBREAK_SPEED = 0.0001;

export function createHandTracker(): HandTrackerState {
  return [];
}

// Max extrapolation speed (units/ms): whatever caps total drift to
// DEAD_RECKON_MAX_DRIFT over the full MAX_GAP_MS window. Capping the *speed*
// (not the resulting displacement) keeps predictPosition strictly increasing
// with atTime — clamping displacement per-call instead would make any two
// calls past the saturation point collapse onto the identical clamped point,
// producing a zero-length segment for the tail of a fast, long dropout and
// silently killing slice detection right when it matters most.
const MAX_DEAD_RECKON_SPEED = CONFIG.DEAD_RECKON_MAX_DRIFT / CONFIG.MAX_GAP_MS;

/**
 * Where the slot's fingertip is believed to be at `atTime`, dead-reckoned
 * from its last real point + smoothed velocity (speed-capped, see above).
 * This is what keeps a blade "live" mid-dropout: renderer and slice detector
 * follow this point instead of freezing at the stale last detection.
 */
export function predictPosition(slot: HandSlot, atTime: number): { x: number; y: number } | null {
  const last = slot.trail[slot.trail.length - 1];
  if (!last) return null;
  const { vx, vy } = slot;
  if (vx === undefined || vy === undefined) return { x: last.x, y: last.y };
  const dt = Math.min(Math.max(0, atTime - last.t), CONFIG.MAX_GAP_MS);
  const speed = Math.hypot(vx, vy);
  const scale = speed > MAX_DEAD_RECKON_SPEED ? MAX_DEAD_RECKON_SPEED / speed : 1;
  const dx = vx * scale * dt;
  const dy = vy * scale * dt;
  return {
    x: Math.min(1, Math.max(0, last.x + dx)),
    y: Math.min(1, Math.max(0, last.y + dy)),
  };
}

export function updateHandTracker(
  state: HandTrackerState,
  detections: HandDetection[],
  now: number
): HandTrackerState {
  const slots = state.map((s) => ({ ...s, trail: s.trail.slice() }));

  // Greedy best-first matching between detections and recently-seen slots.
  const pairs: { score: number; det: number; slot: number }[] = [];
  slots.forEach((slot, si) => {
    if (!slot.active || now - slot.lastSeen > CONFIG.MAX_GAP_MS) return;
    const last = slot.trail[slot.trail.length - 1];
    if (!last) return;
    const { vx, vy } = slot;
    const hasVel = vx !== undefined && vy !== undefined;
    const dt = now - slot.lastSeen;
    const predX = hasVel ? last.x + vx * dt : last.x;
    const predY = hasVel ? last.y + vy * dt : last.y;
    const maxDist = hasVel ? CONFIG.MAX_PREDICTION_ERROR : CONFIG.MAX_MATCH_DISTANCE;
    detections.forEach((det, di) => {
      const dist = Math.hypot(det.x - predX, det.y - predY);
      if (dist > maxDist) return;
      let score = dist;
      if (hasVel && dt > 0) {
        // Crossing-hands tie-breaker: when two slots' predictions meet, pure
        // distance can swap identities, so weight each candidate by how well
        // the detection's implied motion direction agrees with the slot's
        // velocity (1x when aligned, up to 2x when opposed).
        const ivx = (det.x - last.x) / dt;
        const ivy = (det.y - last.y) / dt;
        const speed = Math.hypot(vx, vy);
        const ispeed = Math.hypot(ivx, ivy);
        if (speed > MIN_TIEBREAK_SPEED && ispeed > MIN_TIEBREAK_SPEED) {
          const align = (vx * ivx + vy * ivy) / (speed * ispeed);
          score = dist * (1.5 - 0.5 * align);
        }
      }
      pairs.push({ score, det: di, slot: si });
    });
  });
  pairs.sort((a, b) => a.score - b.score);

  const matchedDets = new Set<number>();
  const matchedSlots = new Set<number>();
  for (const p of pairs) {
    if (matchedDets.has(p.det) || matchedSlots.has(p.slot)) continue;
    matchedDets.add(p.det);
    matchedSlots.add(p.slot);
    const slot = slots[p.slot];
    const det = detections[p.det];
    const last = slot.trail[slot.trail.length - 1];
    if (det.handedness) slot.handedness = det.handedness;
    // The hook re-delivers the previous result between video frames; skip
    // exact repeats so stale frames don't flush real history out of the trail
    // (and don't decay velocity — a repeat is stale data, not a stopped hand).
    // Crucially, lastSeen is NOT bumped here either: it must track the last
    // genuinely new detection, not the last matched callback, or a stalled
    // camera feed that keeps redelivering the same stale point would refresh
    // lastSeen forever and the slot would never hit MAX_GAP_MS to retire.
    if (last && last.x === det.x && last.y === det.y) continue;
    slot.lastSeen = now;
    if (last && now > last.t) {
      const dt = now - last.t;
      const ivx = (det.x - last.x) / dt;
      const ivy = (det.y - last.y) / dt;
      slot.vx = slot.vx === undefined ? ivx : slot.vx + (ivx - slot.vx) * CONFIG.VELOCITY_SMOOTHING;
      slot.vy = slot.vy === undefined ? ivy : slot.vy + (ivy - slot.vy) * CONFIG.VELOCITY_SMOOTHING;
    }
    slot.trail.push({ x: det.x, y: det.y, t: now, bridged: slot.sawGap });
    if (slot.trail.length > CONFIG.TRAIL_LENGTH) slot.trail.shift();
    slot.sawGap = false;
  }

  // Unmatched slots keep their trail within the grace window (so a
  // reappearance bridges the gap); past it they retire. On retirement, the
  // last real point is kept as a one-point "tombstone" (trail otherwise
  // cleared) instead of wiped entirely: a stalled camera keeps redelivering
  // that exact stale point forever, and without the tombstone it would
  // immediately reopen a fresh slot from it below, making `active` churn
  // true forever instead of the slot actually going and staying stale. The
  // tombstone persists across calls (an already-inactive slot is skipped
  // here, not re-processed) until a genuinely different detection reuses
  // its index.
  slots.forEach((slot, si) => {
    if (!slot.active || matchedSlots.has(si)) return;
    if (now - slot.lastSeen > CONFIG.MAX_GAP_MS) {
      const last = slot.trail[slot.trail.length - 1];
      slot.active = false;
      slot.trail = last ? [last] : [];
      slot.sawGap = false;
      slot.vx = undefined;
      slot.vy = undefined;
    } else {
      slot.sawGap = true;
    }
  });

  // Unmatched detections open new slots, reusing retired ones first — unless
  // the detection is identical to a still-tombstoned slot's frozen point.
  detections.forEach((det, di) => {
    if (matchedDets.has(di)) return;
    const tombstoned = slots.some(
      (s) => !s.active && s.trail.length > 0 && s.trail[0].x === det.x && s.trail[0].y === det.y
    );
    if (tombstoned) return;
    let si = slots.findIndex((s) => !s.active);
    if (si === -1) {
      if (slots.length >= MAX_SLOTS) return;
      si = slots.length;
      slots.push({ active: false, trail: [], lastSeen: 0, sawGap: false });
    }
    slots[si] = {
      active: true,
      trail: [{ x: det.x, y: det.y, t: now, bridged: false }],
      lastSeen: now,
      sawGap: false,
      handedness: det.handedness,
    };
  });

  return slots;
}

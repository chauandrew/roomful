/**
 * Persistent hand-slot tracking.
 *
 * MediaPipe's HandLandmarker gives no stable hand identity across frames, and
 * a fast swing can drop detections entirely for a frame or two mid-motion.
 * Each frame's detections are matched to slots seen recently enough
 * (maxGapMs). Each slot keeps a smoothed velocity estimate, and matching is
 * done against the slot's *predicted* position (last point + velocity * gap):
 * a fast swipe travels real distance while undetected, so matching against
 * the stale last position would reject the reappearance and open a spurious
 * new slot (the "teleport"). Slots with no velocity yet fall back to plain
 * distance-to-last-point within maxMatchDistance. No synthetic trail
 * points are fabricated — the trail simply keeps
 * the real points on both sides of the gap, and the straight segment between
 * them is exactly what a segment-intersection slice check needs. Points that
 * follow a gap are marked `bridged` so a renderer can show where bridging
 * happened.
 */
import type { HandDetection, HandSlot } from "./types";

export type { HandDetection, HandSlot, TrailPoint } from "./types";

/**
 * Tuning for the hand tracker. Only `midlineDeadzone` is safe to override
 * per-caller. The numeric engine constants below are ALSO read by
 * `predictPosition` via `DEFAULT_TRACKER_TUNING` (which takes no tuning
 * argument), so overriding e.g. `maxGapMs` or `deadReckonMaxDrift` here would
 * make `predictPosition`'s dead-reckon bridge silently disagree with
 * `updateHandTracker` and drop slices at the tail of a long dropout. If a game
 * ever needs different numeric tuning, thread `tuning` through
 * `predictPosition` (and its detector/draw callers) first.
 */
export interface TrackerTuning {
  maxMatchDistance: number;
  maxPredictionError: number;
  velocitySmoothing: number;
  deadReckonMaxDrift: number;
  maxGapMs: number;
  trailLength: number;
  /** Present => enable sticky per-player attribution; half-width around
   *  x=0.5 within which slot-birth assignment is deferred. */
  midlineDeadzone?: number;
}

export const DEFAULT_TRACKER_TUNING: TrackerTuning = {
  maxMatchDistance: 0.25, // fallback match radius (normalized 0-1) for slots with no velocity estimate yet
  // (a fast swipe can cross ~1/4 of the frame during a short dropout; two
  // players' hands are rarely that close, so this rarely mis-merges)
  maxPredictionError: 0.1, // max distance from a slot's constant-velocity predicted position
  // (measures how much the swipe curved/decelerated during the gap, not raw
  // travel, so it can be much tighter than maxMatchDistance)
  velocitySmoothing: 0.5, // blend of newest frame-to-frame velocity into the running estimate (higher = more responsive, noisier)
  deadReckonMaxDrift: 0.2, // cap on extrapolated ghost-dot travel mid-dropout so a noisy velocity estimate can't fling it off-screen
  maxGapMs: 150, // how long a slot survives with no detection before retiring (~4-9 frames)
  trailLength: 8, // recent fingertip points kept per slot
};

export type HandTrackerState = HandSlot[];

const MAX_SLOTS = 4;
// Below this speed (normalized units/ms) direction is mostly jitter, so the
// trajectory tie-breaker stays out of it.
const MIN_TIEBREAK_SPEED = 0.0001;

export function createHandTracker(): HandTrackerState {
  return [];
}

// Max extrapolation speed (units/ms): whatever caps total drift to
// DEFAULT_TRACKER_TUNING.deadReckonMaxDrift over the full maxGapMs window.
// Capping the *speed* (not the resulting displacement) keeps predictPosition
// strictly increasing with atTime — clamping displacement per-call instead
// would make any two calls past the saturation point collapse onto the
// identical clamped point, producing a zero-length segment for the tail of a
// fast, long dropout and silently killing slice detection right when it
// matters most.
const MAX_DEAD_RECKON_SPEED = DEFAULT_TRACKER_TUNING.deadReckonMaxDrift / DEFAULT_TRACKER_TUNING.maxGapMs;

/**
 * Where the slot's fingertip is believed to be at `atTime`, dead-reckoned
 * from its last real point + smoothed velocity (speed-capped, see above).
 * This is what keeps a blade "live" mid-dropout: renderer and slice detector
 * follow this point instead of freezing at the stale last detection.
 *
 * deadReckon and maxGap are engine constants, identical for both games, so
 * this always uses DEFAULT_TRACKER_TUNING rather than threading a tuning
 * argument through every detector/draw caller.
 */
export function predictPosition(slot: HandSlot, atTime: number): { x: number; y: number } | null {
  const last = slot.trail[slot.trail.length - 1];
  if (!last) return null;
  const { vx, vy } = slot;
  if (vx === undefined || vy === undefined) return { x: last.x, y: last.y };
  const dt = Math.min(Math.max(0, atTime - last.t), DEFAULT_TRACKER_TUNING.maxGapMs);
  const speed = Math.hypot(vx, vy);
  const scale = speed > MAX_DEAD_RECKON_SPEED ? MAX_DEAD_RECKON_SPEED / speed : 1;
  const dx = vx * scale * dt;
  const dy = vy * scale * dt;
  return {
    x: Math.min(1, Math.max(0, last.x + dx)),
    y: Math.min(1, Math.max(0, last.y + dy)),
  };
}

// Tracker space is un-mirrored MediaPipe; the screen is mirrored, so tracker
// x > 0.5 renders on the LEFT of the screen = Player 1 (index 0).
function sideOf(x: number, deadzone: number): 0 | 1 | undefined {
  if (Math.abs(x - 0.5) <= deadzone) return undefined;
  return x > 0.5 ? 0 : 1;
}

export function updateHandTracker(
  state: HandTrackerState,
  detections: HandDetection[],
  now: number,
  tuning: TrackerTuning = DEFAULT_TRACKER_TUNING
): HandTrackerState {
  const slots = state.map((s) => ({ ...s, trail: s.trail.slice() }));

  // Greedy best-first matching between detections and recently-seen slots.
  const pairs: { score: number; det: number; slot: number }[] = [];
  slots.forEach((slot, si) => {
    if (!slot.active || now - slot.lastSeen > tuning.maxGapMs) return;
    const last = slot.trail[slot.trail.length - 1];
    if (!last) return;
    const { vx, vy } = slot;
    const hasVel = vx !== undefined && vy !== undefined;
    const dt = now - slot.lastSeen;
    const predX = hasVel ? last.x + vx * dt : last.x;
    const predY = hasVel ? last.y + vy * dt : last.y;
    const maxDist = hasVel ? tuning.maxPredictionError : tuning.maxMatchDistance;
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
    // Sticky attribution: once a slot has an owner it keeps it; while
    // unassigned, try again each matched detection until the fingertip
    // clears the deadzone. No-op when attribution isn't in use.
    if (tuning.midlineDeadzone !== undefined && slot.player === undefined) {
      const side = sideOf(det.x, tuning.midlineDeadzone);
      if (side !== undefined) slot.player = side;
    }
    // The hook re-delivers the previous result between video frames; skip
    // exact repeats so stale frames don't flush real history out of the trail
    // (and don't decay velocity — a repeat is stale data, not a stopped hand).
    // Crucially, lastSeen is NOT bumped here either: it must track the last
    // genuinely new detection, not the last matched callback, or a stalled
    // camera feed that keeps redelivering the same stale point would refresh
    // lastSeen forever and the slot would never hit maxGapMs to retire.
    if (last && last.x === det.x && last.y === det.y) continue;
    slot.lastSeen = now;
    if (last && now > last.t) {
      const dt = now - last.t;
      const ivx = (det.x - last.x) / dt;
      const ivy = (det.y - last.y) / dt;
      slot.vx = slot.vx === undefined ? ivx : slot.vx + (ivx - slot.vx) * tuning.velocitySmoothing;
      slot.vy = slot.vy === undefined ? ivy : slot.vy + (ivy - slot.vy) * tuning.velocitySmoothing;
    }
    slot.trail.push({ x: det.x, y: det.y, t: now, bridged: slot.sawGap });
    if (slot.trail.length > tuning.trailLength) slot.trail.shift();
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
    if (now - slot.lastSeen > tuning.maxGapMs) {
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
      player: tuning.midlineDeadzone === undefined ? undefined : sideOf(det.x, tuning.midlineDeadzone),
    };
  });

  return slots;
}

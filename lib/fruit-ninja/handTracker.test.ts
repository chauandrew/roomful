import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHandTracker,
  updateHandTracker,
  predictPosition,
  DEFAULT_TRACKER_TUNING,
  type HandTrackerState,
  type HandDetection,
} from "./handTracker";

const FRAME = 16;

/** Feed one detection per frame along a constant-velocity path. */
function feedLine(
  state: HandTrackerState,
  start: { x: number; y: number },
  vel: { vx: number; vy: number }, // units/ms
  t0: number,
  frames: number
): { state: HandTrackerState; lastT: number } {
  let s = state;
  let t = t0;
  for (let i = 0; i < frames; i++) {
    t = t0 + i * FRAME;
    const dt = t - t0;
    s = updateHandTracker(s, [{ x: start.x + vel.vx * dt, y: start.y + vel.vy * dt }], t);
  }
  return { state: s, lastT: t };
}

test("trail grows with correct points/timestamps and caps at TRAIL_LENGTH", () => {
  let s = createHandTracker();
  const pts = [0, 1, 2].map((i) => ({ x: 0.1 + 0.02 * i, y: 0.5, t: 1000 + FRAME * i }));
  for (const p of pts) s = updateHandTracker(s, [{ x: p.x, y: p.y }], p.t);
  assert.equal(s.length, 1);
  assert.deepEqual(
    s[0].trail,
    pts.map((p) => ({ x: p.x, y: p.y, t: p.t, bridged: false }))
  );
  assert.equal(s[0].lastSeen, pts[2].t);

  for (let i = 3; i < 12; i++) {
    s = updateHandTracker(s, [{ x: 0.1 + 0.02 * i, y: 0.5 }], 1000 + FRAME * i);
  }
  assert.equal(s[0].trail.length, DEFAULT_TRACKER_TUNING.trailLength);
  // Oldest points shifted out, newest kept.
  assert.equal(s[0].trail[DEFAULT_TRACKER_TUNING.trailLength - 1].x, 0.1 + 0.02 * 11);
});

test("velocity estimate converges to the true constant velocity", () => {
  const { state } = feedLine(createHandTracker(), { x: 0.1, y: 0.2 }, { vx: 0.002, vy: 0.001 }, 0, 20);
  // Constant motion: every instantaneous sample equals the true velocity, so
  // the smoothed estimate must land exactly on it.
  assert.ok(Math.abs(state[0].vx! - 0.002) < 1e-12);
  assert.ok(Math.abs(state[0].vy! - 0.001) < 1e-12);
});

test("fast swipe surviving a multi-frame dropout re-matches the same slot, bridged", () => {
  // 0.003 units/ms for 96ms of dropout = 0.288 raw travel, beyond
  // maxMatchDistance (0.25) — only prediction-based matching can bridge it.
  assert.ok(0.003 * 96 > DEFAULT_TRACKER_TUNING.maxMatchDistance);
  let { state: s } = feedLine(createHandTracker(), { x: 0.1, y: 0.5 }, { vx: 0.003, vy: 0 }, 0, 4);
  const preGapTrail = s[0].trail.slice();

  for (const t of [64, 80, 96, 112, 128]) {
    s = updateHandTracker(s, [], t);
    assert.equal(s[0].active, true);
    assert.equal(s[0].sawGap, true);
  }

  const reappearX = 0.244 + 0.003 * 96; // exactly where extrapolation predicts
  s = updateHandTracker(s, [{ x: reappearX, y: 0.5 }], 144);
  assert.equal(s.length, 1); // same slot, not a new hand
  const trail = s[0].trail;
  // Pre-gap history intact, reappearance appended and marked bridged.
  assert.deepEqual(trail.slice(0, preGapTrail.length), preGapTrail);
  const tip = trail[trail.length - 1];
  assert.ok(Math.abs(tip.x - reappearX) < 1e-12);
  assert.equal(tip.t, 144);
  assert.equal(tip.bridged, true);
  assert.equal(s[0].sawGap, false);
});

test("stalled camera redelivering one identical point never fabricates motion, and eventually retires", () => {
  // Contract: a fully stalled feed carries zero new information, so the
  // tracker must never build a velocity, a multi-point trail, a bridged
  // point, or a sliceable segment out of it — no matter how long it stalls —
  // and past maxGapMs it must actually go (and stay) inactive rather than
  // being instantly resurrected by the same stale point forever.
  const P = { x: 0.5, y: 0.5 };
  let s = updateHandTracker(createHandTracker(), [P], 1000);
  for (let t = 1000 + FRAME; t <= 1400; t += FRAME) {
    s = updateHandTracker(s, [P], t);
    for (const slot of s.filter((x) => x.active)) {
      assert.equal(slot.trail.length, 1);
      assert.deepEqual(slot.trail[0], { x: P.x, y: P.y, t: slot.trail[0].t, bridged: false });
      assert.equal(slot.vx, undefined);
      assert.equal(slot.vy, undefined);
      assert.equal(slot.sawGap, false);
    }
  }
  assert.ok(s.every((slot) => !slot.active), "no slot survives well past maxGapMs of stale-only input");

  // And it must stay retired — the same stale point arriving again must not
  // resurrect it, only genuinely different motion should open a new slot.
  s = updateHandTracker(s, [P], 1500);
  assert.ok(s.every((slot) => !slot.active), "an identical stale point does not resurrect a retired slot");
  s = updateHandTracker(s, [{ x: 0.51, y: 0.5 }], 1516);
  assert.ok(s.some((slot) => slot.active), "genuinely new motion still opens a fresh slot afterward");
});

test("predictPosition: null without trail, verbatim last point without velocity", () => {
  const empty = { active: true, trail: [], lastSeen: 0, sawGap: false };
  assert.equal(predictPosition(empty, 100), null);

  const noVel = {
    active: true,
    trail: [{ x: 0.3, y: 0.7, t: 100, bridged: false }],
    lastSeen: 100,
    sawGap: false,
  };
  assert.deepEqual(predictPosition(noVel, 300), { x: 0.3, y: 0.7 });
});

test("predictPosition extrapolates a sub-cap constant velocity exactly", () => {
  const slot = {
    active: true,
    trail: [{ x: 0.3, y: 0.5, t: 1000, bridged: false }],
    lastSeen: 1000,
    sawGap: true,
    vx: 0.0005,
    vy: -0.0002,
  };
  const p = predictPosition(slot, 1050)!;
  assert.ok(Math.abs(p.x - (0.3 + 0.0005 * 50)) < 1e-12);
  assert.ok(Math.abs(p.y - (0.5 - 0.0002 * 50)) < 1e-12);
});

test("predictPosition is strictly monotonic in atTime past the speed cap", () => {
  // Regression for the displacement-clamp bug: vx=0.005 saturates the old
  // deadReckonMaxDrift displacement cap by dt=40ms, so dt=60 and dt=100
  // used to collapse onto the identical point (zero-length bridge segment).
  const maxSpeed = DEFAULT_TRACKER_TUNING.deadReckonMaxDrift / DEFAULT_TRACKER_TUNING.maxGapMs;
  const slot = {
    active: true,
    trail: [{ x: 0.3, y: 0.5, t: 1000, bridged: false }],
    lastSeen: 1000,
    sawGap: true,
    vx: 0.005,
    vy: 0,
  };
  assert.ok(0.005 > maxSpeed);
  const p60 = predictPosition(slot, 1060)!;
  const p100 = predictPosition(slot, 1100)!;
  assert.notDeepEqual(p60, p100);
  assert.ok(Math.abs(p60.x - (0.3 + maxSpeed * 60)) < 1e-12);
  assert.ok(Math.abs(p100.x - (0.3 + maxSpeed * 100)) < 1e-12);

  let prev = -Infinity;
  for (const dt of [10, 40, 80, 120, 150]) {
    const x = predictPosition(slot, 1000 + dt)!.x;
    assert.ok(x > prev);
    prev = x;
  }
});

test("predictPosition output stays clamped within [0,1]", () => {
  const base = { active: true, lastSeen: 1000, sawGap: true, vy: 0 };
  const right = { ...base, trail: [{ x: 0.95, y: 0.5, t: 1000, bridged: false }], vx: 0.005 };
  const left = { ...base, trail: [{ x: 0.05, y: 0.5, t: 1000, bridged: false }], vx: -0.005 };
  assert.equal(predictPosition(right, 1150)!.x, 1);
  assert.equal(predictPosition(left, 1150)!.x, 0);
});

function runCrossing(
  aStart: { x: number; y: number },
  aVel: { vx: number; vy: number },
  bStart: { x: number; y: number },
  bVel: { vx: number; vy: number },
  frames: number
): HandTrackerState {
  let s = createHandTracker();
  for (let i = 0; i < frames; i++) {
    const t = i * FRAME;
    const dets: HandDetection[] = [
      { x: aStart.x + aVel.vx * t, y: aStart.y + aVel.vy * t },
      { x: bStart.x + bVel.vx * t, y: bStart.y + bVel.vy * t },
    ];
    s = updateHandTracker(s, dets, t);
  }
  return s;
}

test("two hands crossing paths keep their identities and velocity signs", () => {
  const cases = [
    // head-on along the same horizontal line
    { a0: { x: 0.2, y: 0.5 }, av: { vx: 0.004, vy: 0 }, b0: { x: 0.8, y: 0.5 }, bv: { vx: -0.004, vy: 0 } },
    // diagonal, asymmetric speeds, near-miss crossing
    { a0: { x: 0.2, y: 0.3 }, av: { vx: 0.003, vy: 0.001 }, b0: { x: 0.7, y: 0.55 }, bv: { vx: -0.0035, vy: -0.0025 } },
  ];
  for (const c of cases) {
    const s = runCrossing(c.a0, c.av, c.b0, c.bv, 11);
    const T = 10 * FRAME;
    assert.equal(s.length, 2);
    const [slotA, slotB] = s;
    assert.ok(slotA.vx! > 0 && slotB.vx! < 0); // signs preserved, not swapped
    const tipA = slotA.trail[slotA.trail.length - 1];
    const tipB = slotB.trail[slotB.trail.length - 1];
    assert.ok(Math.abs(tipA.x - (c.a0.x + c.av.vx * T)) < 1e-9);
    assert.ok(Math.abs(tipA.y - (c.a0.y + c.av.vy * T)) < 1e-9);
    assert.ok(Math.abs(tipB.x - (c.b0.x + c.bv.vx * T)) < 1e-9);
    assert.ok(Math.abs(tipB.y - (c.b0.y + c.bv.vy * T)) < 1e-9);
  }
});

test("more than 4 simultaneous detections never exceed 4 slots", () => {
  const dets: HandDetection[] = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((x) => ({ x, y: 0.5 }));
  let s = updateHandTracker(createHandTracker(), dets, 0);
  assert.equal(s.length, 4);
  assert.equal(s.filter((x) => x.active).length, 4);
  // Still capped when a 5th far-away detection shows up later.
  s = updateHandTracker(s, [...dets.slice(0, 4), { x: 0.5, y: 0.05 }], FRAME);
  assert.equal(s.length, 4);
});

test("near detection extends the existing slot; far detection opens a new one", () => {
  const s = updateHandTracker(createHandTracker(), [{ x: 0.2, y: 0.2 }], 0);

  // dist ~0.141 < maxMatchDistance: extends
  const near = updateHandTracker(s, [{ x: 0.3, y: 0.3 }], FRAME);
  assert.equal(near.length, 1);
  assert.equal(near[0].trail.length, 2);

  // dist ~0.72 > maxMatchDistance: new slot
  const far = updateHandTracker(s, [{ x: 0.6, y: 0.8 }], FRAME);
  assert.equal(far.length, 2);
  assert.equal(far[0].trail.length, 1);
  assert.equal(far[1].trail.length, 1);
  assert.equal(far[1].trail[0].x, 0.6);
});

// --- Player attribution (opt-in via tuning.midlineDeadzone) ---

const ATTRIBUTION_TUNING = { ...DEFAULT_TRACKER_TUNING, midlineDeadzone: 0.05 };

test("attribution off by default: player stays undefined regardless of side", () => {
  const s = updateHandTracker(createHandTracker(), [{ x: 0.8, y: 0.5 }], 0);
  assert.equal(s[0].player, undefined);
});

test("slot born right of midline (x=0.8) is assigned player 0", () => {
  const s = updateHandTracker(createHandTracker(), [{ x: 0.8, y: 0.5 }], 0, ATTRIBUTION_TUNING);
  assert.equal(s[0].player, 0);
});

test("slot born left of midline (x=0.2) is assigned player 1", () => {
  const s = updateHandTracker(createHandTracker(), [{ x: 0.2, y: 0.5 }], 0, ATTRIBUTION_TUNING);
  assert.equal(s[0].player, 1);
});

test("slot born inside the deadzone is unassigned, then assigned once a later detection clears it", () => {
  // Small, constant-velocity steps so the slot stays matched via prediction
  // throughout (this is testing attribution timing, not match tolerance).
  let s = updateHandTracker(createHandTracker(), [{ x: 0.5, y: 0.5 }], 0, ATTRIBUTION_TUNING);
  assert.equal(s.length, 1);
  assert.equal(s[0].player, undefined); // born dead-center, deferred

  // Still inside the deadzone (|0.52-0.5| = 0.02 <= 0.05): stays unassigned.
  s = updateHandTracker(s, [{ x: 0.52, y: 0.5 }], FRAME, ATTRIBUTION_TUNING);
  assert.equal(s.length, 1);
  assert.equal(s[0].player, undefined);

  // Still inside the deadzone (|0.54-0.5| = 0.04 <= 0.05): stays unassigned.
  s = updateHandTracker(s, [{ x: 0.54, y: 0.5 }], FRAME * 2, ATTRIBUTION_TUNING);
  assert.equal(s.length, 1);
  assert.equal(s[0].player, undefined);

  // Clears the deadzone to the right (|0.56-0.5| = 0.06 > 0.05, tracker
  // x > 0.5 => player 0).
  s = updateHandTracker(s, [{ x: 0.56, y: 0.5 }], FRAME * 3, ATTRIBUTION_TUNING);
  assert.equal(s.length, 1); // same slot throughout, not re-birthed
  assert.equal(s[0].player, 0);
});

test("owner is sticky across a fingertip path that later crosses the midline", () => {
  // Small per-frame steps so each detection stays within matching range
  // (this is testing sticky ownership, not the matcher's dropout tolerance).
  let s = createHandTracker();
  const xs = [0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2];
  xs.forEach((x, i) => {
    s = updateHandTracker(s, [{ x, y: 0.5 }], i * FRAME, ATTRIBUTION_TUNING);
  });
  assert.equal(s.length, 1); // same slot throughout, never re-birthed
  // Born at x=0.8 (right side) => player 0; later crossing to the left must not flip it.
  assert.equal(s[0].player, 0);
});

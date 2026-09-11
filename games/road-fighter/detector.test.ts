/**
 * Road Fighter detector tests. Run with: npx tsx --test games/road-fighter/detector.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PoseFighterDetector } from "./detector";
import { CONFIG } from "./config";
import type { Landmark } from "@/lib/tracking/types";

const DT = 20;

// Neutral standing baseline: shoulders width 0.2, hips width 0.16.
const SHOULDER_Y = 0.3;
const HIP_Y = 0.5;

/** A visible landmark at (x, y, z) — visibility comfortably clears CONFIG.VISIBILITY_THRESHOLD. */
function point(x: number, y: number, z = 0): Landmark {
  return { x, y, z, visibility: 1 };
}

/**
 * Builds a full landmark array (only the ~6 indices this detector reads are
 * meaningful; the rest are zeroed filler) for a body standing at the neutral
 * baseline, with wrists/hips overridable per test to hit each move's signal.
 * Default wrists are a bent, hands-up "ready stance" (not hanging straight at
 * the sides) — a straight-down arm has roughly the same shoulder-to-wrist
 * distance as a straight-forward punch, so a resting stance has to sit in
 * reach's ambiguous middle zone, not read as an extended move.
 */
function frame(
  opts: {
    wristL?: { x: number; y: number; z?: number };
    wristR?: { x: number; y: number; z?: number };
    hipY?: number;
    // Flips which side of center L_* landmarks sit on — simulates a camera
    // feed where the raw (unmirrored) x-convention runs the opposite way,
    // so tests can check that x-sign-sensitive signals (armsCrossed) don't
    // secretly assume one specific convention.
    mirrored?: boolean;
  } = {}
): Landmark[] {
  const wristL = opts.wristL ?? { x: -0.08, y: 0.45 }; // bent, hands near waist — neutral/ambiguous reach
  const wristR = opts.wristR ?? { x: 0.08, y: 0.45 };
  const hipY = opts.hipY ?? HIP_Y;
  const flip = opts.mirrored ? -1 : 1;

  const landmarks: Landmark[] = new Array(25).fill(point(0, 0));
  landmarks[11] = point(-0.1 * flip, SHOULDER_Y); // L_SHOULDER
  landmarks[12] = point(0.1 * flip, SHOULDER_Y); // R_SHOULDER
  landmarks[15] = point(wristL.x * flip, wristL.y, wristL.z ?? 0); // L_WRIST
  landmarks[16] = point(wristR.x * flip, wristR.y, wristR.z ?? 0); // R_WRIST
  landmarks[23] = point(-0.08 * flip, hipY); // L_HIP
  landmarks[24] = point(0.08 * flip, hipY); // R_HIP
  return landmarks;
}

// Clean move fixtures, each comfortably past its threshold. Shoulder width is
// 0.2 in this baseline, so thresholds normalized by it translate to absolute
// distances here.
const SHORYUKEN = { wristL: { x: -0.05, y: 0.05 }, wristR: { x: 0.1, y: 0.6 } }; // one wrist well above the shoulder line, other well below
const PUNCH = { wristL: { x: -0.05, y: 0.32 }, wristR: { x: 0.35, y: 0.32 } }; // one arm extended far, other tucked in, both level (no height gap)
const GUARD = { wristL: { x: 0.08, y: 0.35 }, wristR: { x: -0.08, y: 0.35 } }; // Wakanda salute — wrists crossed, each landing near the opposite shoulder
const HADOKEN = { wristL: { x: -0.02, y: 0.48 }, wristR: { x: 0.02, y: 0.48 } }; // both wrists extended and pushed together, staying above hip height (not hanging)
const SONICBOOM = { wristL: { x: -0.05, y: -0.05 }, wristR: { x: 0.05, y: -0.05 } }; // both wrists raised well above the shoulder line, together overhead
const NEUTRAL = {}; // standing still, no signal crosses any threshold

/** Fresh detector, calibrated at the neutral standing frame. */
function calibrated(): PoseFighterDetector {
  const d = new PoseFighterDetector();
  const ok = d.calibrate(frame(NEUTRAL));
  assert.equal(ok, true);
  return d;
}

/** Feeds `pose` repeatedly until locked fires (or bails after maxCalls). Returns { locks, calls }. */
function feedUntilLocked(d: PoseFighterDetector, pose: object, maxCalls = 60) {
  let locks = 0;
  let calls = 0;
  for (let i = 0; i < maxCalls; i++) {
    calls++;
    const r = d.update(frame(pose), DT);
    if (r.locked) locks++;
    if (r.locked) break;
  }
  return { locks, calls };
}

const MOVES: Array<[string, object]> = [
  ["shoryuken", SHORYUKEN],
  ["punch", PUNCH],
  ["guard", GUARD],
  ["hadoken", HADOKEN],
  ["sonicboom", SONICBOOM],
];

for (const [name, fixture] of MOVES) {
  test(`a clean ${name} pose classifies as ${name} after calibration + enough held frames`, () => {
    const d = calibrated();
    let last;
    for (let i = 0; i < 30; i++) last = d.update(frame(fixture), DT);
    assert.equal(last!.candidate, name);
  });
}

test("a neutral standing pose classifies as candidate: null and never locks", () => {
  const d = calibrated();
  for (let i = 0; i < 30; i++) {
    const r = d.update(frame(NEUTRAL), DT);
    assert.equal(r.candidate, null);
    assert.equal(r.locked, null);
  }
});

test("uncrossed hands near the waist do not classify as guard", () => {
  // Guard requires the wrists to actually be CROSSED (swapped left/right) —
  // a resting, uncrossed pose can't satisfy it regardless of reach or height.
  const d = calibrated();
  const restingLow = { wristL: { x: -0.15, y: 0.45 }, wristR: { x: 0.15, y: 0.45 } };
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(restingLow), DT).candidate, "guard");
  }
});

test("arms hanging at the sides (long reach, but below hip height) does not classify as hadoken", () => {
  // A hanging arm has roughly the same shoulder-to-wrist DISTANCE as an
  // extended one — this is exactly the false-positive the armsNotHanging
  // guard exists to rule out.
  const d = calibrated();
  const hanging = { wristL: { x: -0.1, y: 0.65 }, wristR: { x: 0.1, y: 0.65 } };
  for (let i = 0; i < 30; i++) {
    const r = d.update(frame(hanging), DT);
    assert.notEqual(r.candidate, "hadoken");
    assert.notEqual(r.candidate, "sonicboom");
  }
});

test("both arms extended equally (symmetric reach) does not classify as punch", () => {
  // Punch is specifically about ASYMMETRY — one arm out, one tucked. Two
  // arms extended together is Hadoken/Sonic Boom's territory, not Punch's.
  const d = calibrated();
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(HADOKEN), DT).candidate, "punch");
  }
});

test("a hand barely lifted off a resting position, with the other hanging low, does not classify as shoryuken", () => {
  // Shoryuken's height-asymmetry check is checked first, with priority over
  // everything else, so a hand only slightly higher than the other (not a
  // real overhead reach) must not be enough to claim it.
  const d = calibrated();
  const barelyLifted = { wristL: { x: -0.08, y: 0.2 }, wristR: { x: 0.08, y: 0.65 } };
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(barelyLifted), DT).candidate, "shoryuken");
  }
});

test("both arms raised overhead but unevenly does not classify as shoryuken", () => {
  // Sonic Boom's two hands are rarely raised to perfectly even heights — the
  // gap between them shouldn't be enough to claim Shoryuken when neither
  // hand is actually down at the hip.
  const d = calibrated();
  const unevenRaise = { wristL: { x: -0.1, y: -0.1 }, wristR: { x: 0.1, y: 0.12 } };
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(unevenRaise), DT).candidate, "shoryuken");
  }
});

test("a looser cross (fists don't quite reach the opposite shoulder) still classifies as guard", () => {
  // A real Wakanda cross doesn't always land the fist exactly on the
  // opposite shoulder — GUARD_REACH_MAX gives it some room past a tight
  // cross, as long as the wrists are still genuinely crossed.
  const d = calibrated();
  const looseCross = { wristL: { x: 0.15, y: 0.15 }, wristR: { x: -0.15, y: 0.15 } };
  for (let i = 0; i < 30; i++) {
    assert.equal(d.update(frame(looseCross), DT).candidate, "guard");
  }
});

test("a raised, uncrossed Sonic Boom does not classify as guard", () => {
  // Both arms going straight up keeps each wrist on its own side — crossing
  // is a deliberate, distinctive gesture nothing else in this set does, so
  // Guard shouldn't be reachable by a normal (uncrossed) raised pose.
  const d = calibrated();
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(SONICBOOM), DT).candidate, "guard");
  }
});

test("guard with a natural forward z-offset (a crossed wrist near the opposite shoulder sits slightly in front of it) still classifies as guard", () => {
  // Reach includes z so a forward PUSH registers (see the hadoken tests
  // below), but a crossed wrist resting near the opposite shoulder is also
  // naturally a little in front of it in depth — that z offset alone must
  // not be enough to knock it out of Guard's cross-reach threshold.
  const d = calibrated();
  const guardWithDepth = { wristL: { x: 0.08, y: 0.35, z: -0.15 }, wristR: { x: -0.08, y: 0.35, z: -0.15 } };
  for (let i = 0; i < 30; i++) {
    assert.equal(d.update(frame(guardWithDepth), DT).candidate, "guard");
  }
});

test("crossed arms are detected the same way even if the raw camera's left/right-to-x convention runs the opposite direction", () => {
  // armsCrossed compares wrist order against THIS FRAME'S OWN shoulder
  // order, rather than assuming a fixed mapping of left/right landmarks to
  // positive/negative x — a real, hardcoded version of that assumption was
  // backwards, so the pose could never actually be triggered from a live
  // camera. This mirrors every x-coordinate in the frame to simulate the
  // other possible raw-camera convention and checks Guard still fires.
  const d = new PoseFighterDetector();
  assert.equal(d.calibrate(frame({ mirrored: true })), true);
  let last;
  for (let i = 0; i < 30; i++) {
    last = d.update(frame({ wristL: GUARD.wristL, wristR: GUARD.wristR, mirrored: true }), DT);
  }
  assert.equal(last!.candidate, "guard");
});

test("punch with the tucked arm sitting slightly forward in z still classifies as punch", () => {
  // Same issue as Guard above, but for punch's tucked (non-extended) arm.
  const d = calibrated();
  const punchWithDepth = { wristL: { x: -0.05, y: 0.32, z: -0.15 }, wristR: { x: 0.35, y: 0.32 } };
  for (let i = 0; i < 30; i++) {
    assert.equal(d.update(frame(punchWithDepth), DT).candidate, "punch");
  }
});

test("a punch thrown straight at the camera (modest reach) still classifies as punch even when the tucked arm has some natural depth too", () => {
  // Regression for a subtler version of the z-offset issue above: if BOTH
  // arms' 3D reach get some inflation from natural depth (the tucked arm's
  // slight forward offset, same as the guard/punch tests above), a modest
  // (not fully locked-out) punch could see its reach GAP shrink below
  // threshold even though the tucked arm alone would pass. The gap must be
  // measured against the tucked arm's 2D reach, not its 3D one.
  const d = calibrated();
  const modestPunchAtCamera = { wristL: { x: -0.1, y: 0.3, z: -0.2 }, wristR: { x: 0.05, y: 0.32, z: -0.15 } };
  for (let i = 0; i < 30; i++) {
    assert.equal(d.update(frame(modestPunchAtCamera), DT).candidate, "punch");
  }
});

test("both arms extended but unevenly (neither tucked in) does not classify as punch", () => {
  // A real Hadoken push is rarely perfectly symmetric — the gap between the
  // two reaches can cross PUNCH_ASYMMETRY_THRESHOLD even when neither arm is
  // actually tucked back. Punch requires the shorter arm to genuinely be
  // tucked in, not just shorter than the other.
  const d = calibrated();
  const unevenPush = { wristL: { x: -0.3, y: 0.3 }, wristR: { x: 0.4, y: 0.3 } };
  for (let i = 0; i < 30; i++) {
    assert.notEqual(d.update(frame(unevenPush), DT).candidate, "punch");
  }
});

test("locked fires on exactly one update() call while the pose is held", () => {
  const d = calibrated();
  let locks = 0;
  for (let i = 0; i < 40; i++) {
    const r = d.update(frame(HADOKEN), DT);
    if (r.locked) locks++;
  }
  assert.equal(locks, 1);
});

test("a brief flicker resets the hold, so it never accumulates enough time to lock", () => {
  const d = calibrated();
  let locked = false;

  // Hold hadoken for less time than STABLE_MS, flicker to neutral for one
  // frame (resetting the hold), then hold hadoken again for less time than
  // STABLE_MS. The total continuous hadoken run never reaches STABLE_MS.
  const holdCalls = Math.floor(CONFIG.STABLE_MS / DT / 2);
  for (let i = 0; i < holdCalls; i++) {
    if (d.update(frame(HADOKEN), DT).locked) locked = true;
  }
  if (d.update(frame(NEUTRAL), DT).locked) locked = true; // flicker
  for (let i = 0; i < holdCalls; i++) {
    if (d.update(frame(HADOKEN), DT).locked) locked = true;
  }

  assert.equal(locked, false);
});

test("landmarks missing or not calibrated yet returns visible:false, candidate:null, locked:null, no throw", () => {
  const fresh = new PoseFighterDetector();
  const r1 = fresh.update(frame(HADOKEN), DT);
  assert.deepEqual(r1, { visible: false, candidate: null, locked: null });

  const d = calibrated();
  const r2 = d.update(undefined, DT);
  assert.deepEqual(r2, { visible: false, candidate: null, locked: null });

  const r3 = d.update(null, DT);
  assert.deepEqual(r3, { visible: false, candidate: null, locked: null });
});

test("calibrate() returns false and leaves state uncalibrated when landmarks are missing", () => {
  const d = new PoseFighterDetector();
  assert.equal(d.calibrate(undefined), false);
  assert.equal(d.calibrate(null), false);
  assert.equal(d.calibrate([]), false);

  // Still uncalibrated: update() must report not-visible rather than classify.
  const r = d.update(frame(HADOKEN), DT);
  assert.equal(r.visible, false);
});

test("switching from one held candidate to a different one resets heldMs (no carryover)", () => {
  // Fresh detector locking straight onto sonicboom takes some number of calls.
  const fresh = calibrated();
  const freshResult = feedUntilLocked(fresh, SONICBOOM);
  assert.ok(freshResult.locks === 1, "fresh detector should lock onto sonicboom");

  // A detector that held shoryuken part-way, then switched to sonicboom,
  // should take the SAME number of calls to lock onto sonicboom — no partial
  // progress carries over.
  const switched = calibrated();
  for (let i = 0; i < 5; i++) {
    const r = switched.update(frame(SHORYUKEN), DT);
    assert.equal(r.locked, null, "should not have locked onto shoryuken yet");
  }
  const switchedResult = feedUntilLocked(switched, SONICBOOM);
  assert.equal(switchedResult.locks, 1);
  assert.equal(switchedResult.calls, freshResult.calls);
});

test("reset() clears calibration and hold state", () => {
  const d = calibrated();
  d.update(frame(HADOKEN), DT);
  d.reset();

  const r = d.update(frame(HADOKEN), DT);
  assert.equal(r.visible, false, "should be uncalibrated again after reset()");
});

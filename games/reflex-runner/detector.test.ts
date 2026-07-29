/**
 * Reflex Runner detector tests. Run with: npx tsx --test games/reflex-runner/detector.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunnerDetector } from "./detector";
import { CONFIG } from "./config";
import type { Landmark } from "@/lib/tracking/types";

const BASELINE_WIDTH = 0.2; // shoulders at x = -0.1 / +0.1

/** A visible landmark at (x, y) — visibility comfortably clears CONFIG.VISIBILITY_THRESHOLD. */
function point(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 1 };
}

/**
 * Builds a frame whose shoulder-center sits `leanX` shoulder-widths right of
 * center and `duckY` shoulder-widths below center, with shoulder width fixed
 * at BASELINE_WIDTH so a calibrate() on the (0, 0) frame yields exactly that
 * baseline.
 */
function frame(leanX: number, duckY: number): Landmark[] {
  const landmarks: Landmark[] = new Array(13).fill(point(0, 0));
  const cx = leanX * BASELINE_WIDTH;
  const cy = duckY * BASELINE_WIDTH;
  landmarks[11] = point(cx - BASELINE_WIDTH / 2, cy); // L_SHOULDER
  landmarks[12] = point(cx + BASELINE_WIDTH / 2, cy); // R_SHOULDER
  return landmarks;
}

/** Fresh detector, calibrated at the neutral (0, 0) baseline. */
function calibrated(): RunnerDetector {
  const detector = new RunnerDetector();
  detector.calibrate(frame(0, 0));
  return detector;
}

/**
 * Feeds the same (leanX, duckY) frame CONFIG.SMOOTHING_WINDOW times, so the
 * moving averages fully settle on it (no residual signal from a previous
 * phase still sitting in the window) before returning the last result.
 */
function settle(d: RunnerDetector, leanX: number, duckY: number, dt = 20) {
  let result;
  for (let i = 0; i < CONFIG.SMOOTHING_WINDOW; i++) {
    result = d.update(frame(leanX, duckY), dt);
  }
  return result!;
}

test("leaning past LANE_ENTER_THRESHOLD switches lane from center", () => {
  const right = calibrated();
  const r1 = right.update(frame(CONFIG.LANE_ENTER_THRESHOLD + 0.05, 0), 20);
  assert.equal(r1.lane, 2);

  const left = calibrated();
  const r2 = left.update(frame(-(CONFIG.LANE_ENTER_THRESHOLD + 0.05), 0), 20);
  assert.equal(r2.lane, 0);
});

test("lane hysteresis: leaning back only partway does not flicker to center", () => {
  const d = calibrated();
  assert.equal(settle(d, CONFIG.LANE_ENTER_THRESHOLD + 0.05, 0).lane, 2);

  // Between LANE_EXIT_THRESHOLD and LANE_ENTER_THRESHOLD: still in lane 2.
  const partial = (CONFIG.LANE_EXIT_THRESHOLD + CONFIG.LANE_ENTER_THRESHOLD) / 2;
  assert.equal(settle(d, partial, 0).lane, 2);

  // Past LANE_EXIT_THRESHOLD: back to center.
  assert.equal(settle(d, CONFIG.LANE_EXIT_THRESHOLD - 0.05, 0).lane, 1);
});

test("sustained crouch sets ducking true; standing back up clears it", () => {
  const d = calibrated();
  const r1 = settle(d, 0, CONFIG.DUCK_ENTER_THRESHOLD + 0.05);
  assert.equal(r1.ducking, true);

  const r2 = settle(d, 0, CONFIG.DUCK_EXIT_THRESHOLD - 0.05);
  assert.equal(r2.ducking, false);
});

test("a fast sustained rise fires jumped on exactly one update() call", () => {
  const d = calibrated();
  const risenY = CONFIG.JUMP_RISE_THRESHOLD - 0.1; // more negative = more risen
  const dt = 20;

  let jumps = 0;
  for (let i = 0; i < 10; i++) {
    if (d.update(frame(0, risenY), dt).jumped) jumps++;
  }

  assert.equal(jumps, 1);
});

test("a jump's rise does not fire twice in a row (cooldown holds through one physical jump)", () => {
  const d = calibrated();
  const risenY = CONFIG.JUMP_RISE_THRESHOLD - 0.1;
  const dt = 20;

  let jumps = 0;
  let elapsed = 0;
  // Keep the rise condition true for less than the cooldown window.
  while (elapsed < CONFIG.JUMP_COOLDOWN_MS - dt) {
    if (d.update(frame(0, risenY), dt).jumped) jumps++;
    elapsed += dt;
  }

  assert.equal(jumps, 1);
});

test("small still-body jitter never fires a phantom jump or flips lane/ducking", () => {
  const d = calibrated();
  const jitter = [0.01, -0.008, 0.006, -0.009, 0.007, -0.005, 0.008, -0.006, 0.004, -0.01];

  let jumps = 0;
  for (const j of jitter) {
    const r = d.update(frame(j, j), 20);
    if (r.jumped) jumps++;
    assert.equal(r.lane, 1);
    assert.equal(r.ducking, false);
  }

  assert.equal(jumps, 0);
});

test("a held duck survives a long hold with natural sway, and never fires a phantom jump", () => {
  const d = calibrated();
  const duckY = CONFIG.DUCK_ENTER_THRESHOLD + 0.1;
  const r0 = settle(d, 0, duckY);
  assert.equal(r0.ducking, true);

  // Small natural body sway while held crouched, safely within the
  // hysteresis band (nowhere near DUCK_EXIT_THRESHOLD or JUMP_RISE_THRESHOLD).
  const jitter = [0.03, -0.02, 0.01, -0.03, 0.02, -0.01, 0.025, -0.015];
  const dt = 20;
  const totalCalls = 400; // 8 simulated seconds at 20ms/frame

  for (let i = 0; i < totalCalls; i++) {
    const r = d.update(frame(0, duckY + jitter[i % jitter.length]), dt);
    assert.equal(r.ducking, true, `ducking flipped false at call ${i}`);
    assert.equal(r.jumped, false, `phantom jump fired at call ${i}`);
  }
});

test("calibrate() returns the baseline {x, width} for a known frame", () => {
  const d = new RunnerDetector();
  const result = d.calibrate(frame(0, 0));

  assert.deepEqual(result, { x: 0, width: BASELINE_WIDTH });
});

test("calibrate() returns null when landmarks are missing or lack shoulders", () => {
  const d = new RunnerDetector();

  assert.equal(d.calibrate(undefined), null);
  assert.equal(d.calibrate(null), null);
  assert.equal(d.calibrate([]), null);
});

test("update() before calibrate() does not throw and returns neutral output", () => {
  const d = new RunnerDetector();
  const r = d.update(frame(1, 1), 20);

  assert.equal(r.visible, true);
  assert.equal(r.lane, 1);
  assert.equal(r.ducking, false);
  assert.equal(r.jumped, false);

  // Also safe with no landmarks at all.
  const r2 = d.update(undefined, 20);
  assert.equal(r2.visible, false);
});

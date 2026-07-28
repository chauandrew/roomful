/**
 * Flappy Human flap-detection tests. Run with: npm run test:flappy-human
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlapDetector } from "./detector";
import type { Landmark } from "@/lib/tracking/types";

/** A visible landmark at (x, y) — visibility comfortably clears CONFIG.VISIBILITY_THRESHOLD. */
function point(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 1 };
}

/** Builds a frame with fixed shoulders and both wrists at `wristY` (symmetric swing). */
function frame(wristY: number): Landmark[] {
  const landmarks: Landmark[] = new Array(17).fill(point(0, 0));
  landmarks[11] = point(-0.1, 0); // L_SHOULDER
  landmarks[12] = point(0.1, 0); // R_SHOULDER
  landmarks[15] = point(-0.1, wristY); // L_WRIST
  landmarks[16] = point(0.1, wristY); // R_WRIST
  return landmarks;
}

/**
 * Feeds a [wristY, dtMs] sequence into a fresh detector and returns how many
 * calls reported `flapped: true`.
 */
function countFlaps(sequence: [number, number][]): number {
  const detector = new FlapDetector();
  let flaps = 0;
  for (const [wristY, dtMs] of sequence) {
    if (detector.update(frame(wristY), dtMs).flapped) flaps++;
  }
  return flaps;
}

/** Expands [deltaPerFrame, frameCount] segments into a cumulative wristY, dtMs sequence. */
function segments(dtMs: number, parts: [number, number][]): [number, number][] {
  const out: [number, number][] = [[0, dtMs]]; // seed frame, no motion yet
  let y = 0;
  for (const [delta, count] of parts) {
    for (let i = 0; i < count; i++) {
      y += delta;
      out.push([y, dtMs]);
    }
  }
  return out;
}

test("a single downswing with a brief mid-swing deceleration plateau fires exactly one flap", () => {
  const dt = 20; // ~50fps
  // Down fast (well above FLAP_START_VELOCITY) -> brief flat plateau, long enough
  // to dip below FLAP_START_VELOCITY * FLAP_SETTLE_FRACTION and settle for
  // FLAP_SETTLE_MS, which fires flap #1 and starts the cooldown -> the arm keeps
  // descending (velocity back above FLAP_START_VELOCITY) all through the
  // FLAP_COOLDOWN_MS window -> only once it truly stops at the bottom does the
  // detector return to idle. Regresses to 2 flaps if cooldown exit stops
  // checking velocity and goes back to a bare timer.
  const sequence = segments(dt, [
    [0.006, 6], // down fast
    [0, 6], // plateau: settles and fires flap #1, enters cooldown
    [0.006, 15], // keeps descending through the whole cooldown window
    [0, 5], // finally stops for good
  ]);

  assert.equal(countFlaps(sequence), 1);
});

test("rapid repeated flapping fires once per rep, with no raise-first required", () => {
  const dt = 20;
  const rep: [number, number][] = [
    [0.006, 6], // down fast
    [0, 20], // brief pause: settles, fires, and clears the cooldown before the next rep
  ];
  const sequence = segments(dt, [...rep, ...rep, ...rep]);

  assert.equal(countFlaps(sequence), 3);
});

test("small still-arm jitter never fires a flap", () => {
  const dt = 20;
  // Alternating small deltas: net travel stays far under FLAP_MIN_TRAVEL, even
  // though a couple of single-frame jumps briefly cross FLAP_START_VELOCITY.
  const jitter = [0.003, -0.002, 0.003, -0.004, 0.002, -0.001, -0.002, 0.003, -0.003, 0.001];
  const parts: [number, number][] = jitter.map((delta) => [delta, 1]);
  const sequence = segments(dt, Array(4).fill(parts).flat());

  assert.equal(countFlaps(sequence), 0);
});

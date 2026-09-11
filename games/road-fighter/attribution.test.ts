import { test } from "node:test";
import assert from "node:assert/strict";
import { attributePlayers, poseSpan } from "./attribution";
import { CONFIG } from "./config";
import type { Landmark } from "@/lib/tracking/types";

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;

function point(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 1 };
}

// A synthetic pose with shoulders/hips centered horizontally on `centerX`,
// spanning `span` vertically (shoulder-to-hip distance). `centerX` is in raw
// (unmirrored) landmark space, matching what MediaPipe actually reports.
// attributePlayers un-mirrors it internally (1 - x) before deciding a side,
// so a small raw centerX (e.g. 0.2) lands on the mirrored screen's RIGHT
// half (player 2) and a large one (e.g. 0.8) lands on the mirrored LEFT
// half (player 1) — the opposite of what the raw number alone suggests.
function pose(centerX: number, span: number): Landmark[] {
  const landmarks: Landmark[] = new Array(25).fill(point(0, 0));
  landmarks[L_SHOULDER] = point(centerX - 0.05, 0.3);
  landmarks[R_SHOULDER] = point(centerX + 0.05, 0.3);
  landmarks[L_HIP] = point(centerX - 0.05, 0.3 + span);
  landmarks[R_HIP] = point(centerX + 0.05, 0.3 + span);
  return landmarks;
}

const BIG_SPAN = CONFIG.MIN_POSE_SPAN + 0.1;
const SMALL_SPAN = CONFIG.MIN_POSE_SPAN - 0.05;

test("poseSpan is the shoulder-center to hip-center distance", () => {
  assert.ok(Math.abs(poseSpan(pose(0.5, 0.2), 1) - 0.2) < 1e-9);
});

test("poseSpan is 0 when required landmarks are missing", () => {
  assert.equal(poseSpan([], 1), 0);
  assert.equal(poseSpan(new Array(25).fill(undefined) as Landmark[], 1), 0);
});

test("assigns a well-separated left and right detection regardless of order", () => {
  const left = pose(0.8, BIG_SPAN); // raw x=0.8 -> mirrored 0.2 -> player 1 (visual left)
  const right = pose(0.2, BIG_SPAN); // raw x=0.2 -> mirrored 0.8 -> player 2 (visual right)

  assert.deepEqual(attributePlayers([left, right], 1), [left, right]);
  assert.deepEqual(attributePlayers([right, left], 1), [left, right]);
});

test("a single valid left detection returns [landmarks, null]", () => {
  const left = pose(0.8, BIG_SPAN);
  assert.deepEqual(attributePlayers([left], 1), [left, null]);
});

test("a single valid right detection returns [null, landmarks]", () => {
  const right = pose(0.2, BIG_SPAN);
  assert.deepEqual(attributePlayers([right], 1), [null, right]);
});

test("a too-small detection is filtered out entirely, even alone", () => {
  const tiny = pose(0.8, SMALL_SPAN);
  assert.deepEqual(attributePlayers([tiny], 1), [null, null]);
});

test("two detections on the same side keep only the larger-span one", () => {
  const bigLeft = pose(0.8, BIG_SPAN + 0.1);
  const smallLeft = pose(0.7, BIG_SPAN); // raw x=0.7 -> mirrored 0.3 -> still player 1 (left)

  assert.deepEqual(attributePlayers([smallLeft, bigLeft], 1), [bigLeft, null]);
  assert.deepEqual(attributePlayers([bigLeft, smallLeft], 1), [bigLeft, null]);
});

test("empty landmarksList returns [null, null] without throwing", () => {
  assert.deepEqual(attributePlayers([], 1), [null, null]);
});

test("a detection missing required landmarks is treated as span 0 and filtered out", () => {
  const malformed: Landmark[] = new Array(10).fill(point(0, 0)); // no hip landmarks
  assert.deepEqual(attributePlayers([malformed], 1), [null, null]);
});

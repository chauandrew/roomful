import { test } from "node:test";
import assert from "node:assert/strict";
import { handSpan, MIN_HAND_SPAN } from "./handSelection";
import type { Landmark } from "@/lib/tracking/types";

function point(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 1 };
}

function hand(wristY: number, mcpY: number): Landmark[] {
  const landmarks: Landmark[] = new Array(21).fill(point(0, 0));
  landmarks[0] = point(0.5, wristY); // WRIST
  landmarks[9] = point(0.5, mcpY); // MIDDLE_MCP
  return landmarks;
}

test("handSpan is the wrist-to-middle-MCP distance", () => {
  assert.equal(handSpan(hand(0.5, 0.3), 1), 0.2);
});

test("handSpan scales the x delta by aspect", () => {
  const landmarks: Landmark[] = new Array(21).fill(point(0, 0));
  landmarks[0] = point(0.3, 0.5);
  landmarks[9] = point(0.5, 0.5);
  assert.equal(handSpan(landmarks, 2), 0.4); // (0.2 * 2, 0) -> hypot = 0.4
});

test("handSpan is 0 when required landmarks are missing", () => {
  assert.equal(handSpan([], 1), 0);
  assert.equal(handSpan(new Array(21).fill(undefined) as Landmark[], 1), 0);
});

test("a close player's hand clears MIN_HAND_SPAN; a distant background hand does not", () => {
  const playerHand = hand(0.7, 0.4); // large span
  const backgroundHand = hand(0.51, 0.49); // tiny span
  assert.ok(handSpan(playerHand, 1) >= MIN_HAND_SPAN);
  assert.ok(handSpan(backgroundHand, 1) < MIN_HAND_SPAN);
});

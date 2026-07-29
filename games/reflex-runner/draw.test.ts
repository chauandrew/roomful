/**
 * Reflex Runner draw tests. Run with: npx tsx --test games/reflex-runner/draw.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "./config";
import { laneGuideXPositions } from "./draw";

test("laneGuideXPositions returns the exact LANE_ENTER_THRESHOLD boundary positions", () => {
  const baseline = { x: 0.5, width: 0.2 };
  const [left, right] = laneGuideXPositions(baseline);

  assert.equal(left, 0.5 - CONFIG.LANE_ENTER_THRESHOLD * 0.2);
  assert.equal(right, 0.5 + CONFIG.LANE_ENTER_THRESHOLD * 0.2);
});

test("laneGuideXPositions is symmetric around baseline.x for any baseline", () => {
  for (const baseline of [{ x: 0.5, width: 0.2 }, { x: 0.3, width: 0.12 }]) {
    const [left, right] = laneGuideXPositions(baseline);
    assert.ok(Math.abs(baseline.x - left - (right - baseline.x)) < 1e-9);
  }
});

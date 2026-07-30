/**
 * Reflex Runner draw tests. Run with: npx tsx --test games/reflex-runner/draw.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { laneGuideXPositions } from "./draw";

test("laneGuideXPositions divides the frame into equal thirds", () => {
  const [left, right] = laneGuideXPositions();

  assert.equal(left, 1 / 3);
  assert.equal(right, 2 / 3);
});

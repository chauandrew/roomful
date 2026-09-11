import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pose } from "./config";
import { BEATS } from "./config";
import { resolveRound } from "./logic";

// Both orderings of every one of BEATS' 10 winner/loser pairs, generated
// from the table itself so this stays exhaustive even if BEATS changes.
const BEAT_CASES: Array<[Pose, Pose, "a" | "b"]> = [];
for (const winner of Object.keys(BEATS) as Pose[]) {
  for (const loser of BEATS[winner]) {
    BEAT_CASES.push([winner, loser, "b"]);
    BEAT_CASES.push([loser, winner, "a"]);
  }
}

for (const [poseA, poseB, loser] of BEAT_CASES) {
  test(`${poseA} vs ${poseB} -> ${loser} loses (beat)`, () => {
    assert.deepEqual(resolveRound(poseA, poseB), { loser, reason: "beat" });
  });
}

const TIE_POSES: Pose[] = ["hadoken", "shoryuken", "punch", "guard", "sonicboom"];

for (const pose of TIE_POSES) {
  test(`${pose} vs ${pose} -> tie`, () => {
    assert.deepEqual(resolveRound(pose, pose), { loser: null, reason: "tie" });
  });
}

test("no pose for a -> a loses (no-pose)", () => {
  assert.deepEqual(resolveRound(null, "hadoken"), { loser: "a", reason: "no-pose" });
});

test("no pose for a, b guard -> a loses (no-pose)", () => {
  assert.deepEqual(resolveRound(null, "guard"), { loser: "a", reason: "no-pose" });
});

test("no pose for b -> b loses (no-pose)", () => {
  assert.deepEqual(resolveRound("punch", null), { loser: "b", reason: "no-pose" });
});

test("no pose for both -> double-no-pose", () => {
  assert.deepEqual(resolveRound(null, null), { loser: null, reason: "double-no-pose" });
});

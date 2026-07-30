/**
 * Reflex Runner physics tests. Run with: npx tsx --test games/reflex-runner/physics.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "./config";
import { initState, step, randomObstacleGroup, type GameState, type Obstacle } from "./physics";

const { OBSTACLE_THICKNESS } = CONFIG;

/** initState() with one obstacle already positioned, and any other fields overridden. */
function stateWith(obstacle: Obstacle, overrides: Partial<GameState> = {}): GameState {
  return { ...initState(), obstacles: [obstacle], ...overrides };
}

const noInput = { lane: 1 as const, ducking: false, jumped: false };

// mulberry32 — tiny seeded PRNG so property tests over randomObstacleGroup()
// are reproducible: any failure re-runs with the exact same sequence instead
// of depending on whatever Math.random() happened to produce that run.
function seededRandom(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a jump obstacle is cleared while airborne, and kills when not", () => {
  const airborne = stateWith({ z: 0, type: "jump", lane: 1, passed: false }, { airborneMs: 300 });
  const cleared = step(airborne, 0, noInput);
  assert.equal(cleared.status, "running");

  const grounded = stateWith({ z: 0, type: "jump", lane: 1, passed: false }, { airborneMs: 0 });
  const dead = step(grounded, 0, noInput);
  assert.equal(dead.status, "dead");
});

test("a duck obstacle is cleared while ducking, and kills when not", () => {
  const cleared = step(
    stateWith({ z: 0, type: "duck", lane: 1, passed: false }),
    0,
    { lane: 1, ducking: true, jumped: false },
  );
  assert.equal(cleared.status, "running");

  const dead = step(stateWith({ z: 0, type: "duck", lane: 1, passed: false }), 0, noInput);
  assert.equal(dead.status, "dead");
});

test("a lane obstacle is cleared when in a different lane, and kills when lanes match", () => {
  const cleared = step(
    stateWith({ z: 0, type: "lane", lane: 1, passed: false }),
    0,
    { lane: 0, ducking: false, jumped: false },
  );
  assert.equal(cleared.status, "running");

  const dead = step(
    stateWith({ z: 0, type: "lane", lane: 1, passed: false }),
    0,
    { lane: 1, ducking: false, jumped: false },
  );
  assert.equal(dead.status, "dead");
});

test("score increments exactly once per obstacle fully passed without collision", () => {
  const justPassed = stateWith({ z: -OBSTACLE_THICKNESS - 1, type: "lane", lane: 1, passed: false });
  const s = step(justPassed, 0, noInput);
  assert.equal(s.score, 1);
  assert.equal(s.status, "running");
});

test("a colliding obstacle never also scores", () => {
  const colliding = stateWith({ z: 0, type: "lane", lane: 1, passed: false }, { lane: 1 });
  const s = step(colliding, 0, { lane: 1, ducking: false, jumped: false });
  assert.equal(s.status, "dead");
  assert.equal(s.score, 0);
});

test("once dead, further step() calls are no-ops", () => {
  const dead = step(stateWith({ z: 0, type: "lane", lane: 1, passed: false }), 0, {
    lane: 1,
    ducking: false,
    jumped: false,
  });
  assert.equal(dead.status, "dead");
  const frozen = step(dead, 16, noInput);
  assert.equal(frozen, dead); // same reference: step() is a no-op once dead
});

test("FAR_Z gives at least MIN_REACTION_MS of warning even at max ramp speed", () => {
  assert.ok(CONFIG.FAR_Z / CONFIG.SPEED_END >= CONFIG.MIN_REACTION_MS / 1000);
});

test("a hurdle-then-duck at max ramp speed always leaves JUMP_LANDING_BUFFER_MS to land and duck", () => {
  const worstCaseGapMs = (CONFIG.SPACING_END / CONFIG.SPEED_END) * 1000;
  assert.ok(CONFIG.JUMP_DURATION_END_MS + CONFIG.JUMP_LANDING_BUFFER_MS <= worstCaseGapMs);
});

test("randomObstacleGroup never pairs before DOUBLE_OBSTACLE_START_MS", () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(randomObstacleGroup(CONFIG.DOUBLE_OBSTACLE_START_MS - 1).length, 1);
  }
});

test("randomObstacleGroup pairs never combine jump+duck, and lane+lane pairs always use two different lanes", () => {
  // Seeded so a failure is reproducible instead of a one-off roll of Math.random().
  const originalRandom = Math.random;
  Math.random = seededRandom(42);
  try {
    let sawPair = false;
    for (let i = 0; i < 500; i++) {
      const group = randomObstacleGroup(CONFIG.DOUBLE_OBSTACLE_START_MS);
      assert.ok(group.length === 1 || group.length === 2);
      if (group.length !== 2) continue;
      sawPair = true;

      const types = group.map((o) => o.type);
      assert.ok(!(types.includes("jump") && types.includes("duck")), "jump and duck must never pair");

      if (types[0] === "lane" && types[1] === "lane") {
        assert.notEqual(group[0].lane, group[1].lane);
      }
    }
    assert.ok(sawPair, "expected at least one pair across 500 tries at DOUBLE_OBSTACLE_CHANCE");
  } finally {
    Math.random = originalRandom;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpawnState, spawnDue, updateEntities, type Entity, type SpawnConfig } from "./physics";

// Values mirror games/fruit-ninja/config.ts so this suite's expectations
// stay pinned to the co-op game's actual tuning, even though the engine
// itself is config-agnostic.
const SPAWN_CONFIG: SpawnConfig = {
  roundDurationMs: 45000,
  intervalStartMs: 1300,
  intervalEndMs: 450,
  launchSpeedStart: 1.4,
  launchSpeedEnd: 1.65,
  launchVxMax: 0.25,
  spawnXMargin: 0.15,
  bombProbability: 0.15,
  fruitRadius: 0.06,
  bombRadius: 0.055,
  fruitColors: ["#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa", "#c084fc"],
};
const GRAVITY = 1.2;

/** Deterministic LCG stand-in for Math.random so runs are reproducible. */
function stubRandom(fn: () => number, body: () => void) {
  const orig = Math.random;
  Math.random = fn;
  try {
    body();
  } finally {
    Math.random = orig;
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function fruit(over: Partial<Entity>): Entity {
  return { id: 1, kind: "fruit", x: 0.5, y: 0.5, vx: 0, vy: 0, radius: SPAWN_CONFIG.fruitRadius, color: "#f87171", ...over };
}

test("spawn interval and launch speed ramp from START to END across the round", () => {
  stubRandom(() => 0.5, () => {
    // Stepping elapsed to exactly each scheduled time yields one spawn per
    // call, so consecutive scheduled times give the exact interval sequence.
    let state = createSpawnState();
    const times: number[] = [];
    const speeds: number[] = [];
    while (state.nextSpawnAtMs <= SPAWN_CONFIG.roundDurationMs) {
      times.push(state.nextSpawnAtMs);
      const r = spawnDue(state, state.nextSpawnAtMs, SPAWN_CONFIG);
      state = r.state;
      assert.equal(r.spawned.length, 1);
      const e = r.spawned[0];
      speeds.push(-e.vy); // random=0.5 => jitter factor exactly 1
      for (const [k, v] of Object.entries(e)) {
        if (k === "kind" || k === "color") assert.equal(typeof v, "string");
        else assert.ok(Number.isFinite(v), `${k} is finite`);
      }
    }

    const intervals = times.slice(1).map((t, i) => t - times[i]);
    for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] < intervals[i - 1]);
    assert.ok(intervals[0] > 1250 && intervals[0] <= SPAWN_CONFIG.intervalStartMs);
    assert.ok(intervals[intervals.length - 1] < 500 && intervals[intervals.length - 1] >= SPAWN_CONFIG.intervalEndMs);

    for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1]);
    assert.ok(Math.abs(speeds[0] - SPAWN_CONFIG.launchSpeedStart) < 0.02);
    assert.ok(Math.abs(speeds[speeds.length - 1] - SPAWN_CONFIG.launchSpeedEnd) < 0.03);
  });
});

test("spawn schedule is keyed to scheduled time, not frame time", () => {
  // Same time range covered by many small ticks vs three huge jumps must
  // produce the identical spawn schedule — a long frame can't skip the ramp.
  const run = (elapsedSteps: number[]) => {
    let state = createSpawnState();
    const all: Entity[] = [];
    stubRandom(lcg(42), () => {
      for (const elapsed of elapsedSteps) {
        const r = spawnDue(state, elapsed, SPAWN_CONFIG);
        state = r.state;
        all.push(...r.spawned);
      }
    });
    return { all, final: state };
  };

  const fine: number[] = [];
  for (let t = 100; t <= 45000; t += 100) fine.push(t);
  const a = run(fine);
  const b = run([15000, 30000, 45000]);

  assert.ok(a.all.length > 40);
  assert.equal(a.all.length, b.all.length);
  assert.equal(a.final.nextSpawnAtMs, b.final.nextSpawnAtMs);
  // Ramp-derived per-entity values match spawn for spawn.
  assert.deepEqual(a.all.map((e) => e.vy), b.all.map((e) => e.vy));
  assert.deepEqual(a.all.map((e) => e.kind), b.all.map((e) => e.kind));
});

test("a launched fruit arcs: vy flips negative to positive, then falls off and is missed", () => {
  let entities = [fruit({ y: 1 + SPAWN_CONFIG.fruitRadius, vy: -SPAWN_CONFIG.launchSpeedStart })];
  assert.ok(entities[0].vy < 0);
  let sawPositiveVy = false;
  const missed: Entity[] = [];
  for (let i = 0; i < 100 && entities.length > 0; i++) {
    const r = updateEntities(entities, 50, GRAVITY);
    entities = r.entities;
    if (entities.length > 0 && entities[0].vy > 0) sawPositiveVy = true;
    missed.push(...r.missedFruit);
  }
  assert.equal(sawPositiveVy, true);
  assert.equal(entities.length, 0); // eventually culled
  assert.equal(missed.length, 1); // ...and reported as a miss
});

test("a bomb falling off the bottom is culled but never counts as missed fruit", () => {
  let entities: Entity[] = [
    {
      id: 7,
      kind: "bomb",
      x: 0.5,
      y: 1 + SPAWN_CONFIG.bombRadius,
      vx: 0,
      vy: -SPAWN_CONFIG.launchSpeedStart,
      radius: SPAWN_CONFIG.bombRadius,
      color: "#000",
    },
  ];
  const allMissed: Entity[] = [];
  for (let i = 0; i < 100 && entities.length > 0; i++) {
    const r = updateEntities(entities, 50, GRAVITY);
    entities = r.entities;
    allMissed.push(...r.missedFruit);
  }
  assert.equal(entities.length, 0);
  assert.equal(allMissed.length, 0);
});

test("entities still rising or still on screen are never culled", () => {
  // Freshly launched: below the bottom edge but moving up — must be kept.
  const rising = updateEntities([fruit({ y: 1.2, vy: -1.4 })], 16, GRAVITY);
  assert.equal(rising.entities.length, 1);
  assert.equal(rising.missedFruit.length, 0);

  // Falling but still on screen — kept.
  const falling = updateEntities([fruit({ y: 0.5, vy: 0.8 })], 16, GRAVITY);
  assert.equal(falling.entities.length, 1);
  assert.equal(falling.missedFruit.length, 0);
});

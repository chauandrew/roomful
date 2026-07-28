/**
 * Flappy Human physics tests. Run with: npm run test:flappy-human
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "./config";
import { computeDifficulty, initState, step, type GameState } from "./physics";

const { GAME_H, BIRD_X, BIRD_RADIUS, FLAP_IMPULSE, PIPE_WIDTH, PIPE_GAP_START } = CONFIG;

/** Advance `state` by `steps` frames of `dtMs` each, with no flap throughout. */
function run(state: GameState, dtMs: number, steps: number): GameState {
  let s = state;
  for (let i = 0; i < steps; i++) s = step(s, dtMs, false);
  return s;
}

/** Force the bird to a safe mid-air position/velocity so gravity/collision can't interfere with unrelated assertions. */
function pinBird(s: GameState): GameState {
  return { ...s, status: "flying", birdY: GAME_H / 2, birdVy: 0 };
}

/** Spawn the first pipe (one frame in) with the bird pinned safe mid-air. */
function flying(): GameState {
  const s = step(initState(), 16, false);
  return pinBird(s);
}

test("initState starts flying (no hover phase), centered, with no pipes and zero score", () => {
  const s = initState();
  assert.equal(s.status, "flying");
  assert.equal(s.birdY, GAME_H / 2);
  assert.equal(s.birdVy, 0);
  assert.deepEqual(s.pipes, []);
  assert.equal(s.score, 0);
});

test("gravity applies from the very first step, with no flap needed to start", () => {
  const s = initState();
  const vy0 = s.birdVy;
  const s1 = step(s, 100, false);
  assert.ok(s1.birdVy > vy0); // falling immediately, no flap required
});

test("every flap applies the same impulse regardless of how it happened", () => {
  const a = step(initState(), 16, true);
  const b = step(initState(), 16, true);
  assert.equal(a.birdVy, FLAP_IMPULSE);
  assert.equal(b.birdVy, FLAP_IMPULSE);
});

test("gravity increases birdVy (more downward) over time while flying with no flap", () => {
  let s = initState();
  const vy0 = s.birdVy;
  s = step(s, 100, false);
  const vy1 = s.birdVy;
  s = step(s, 100, false);
  const vy2 = s.birdVy;
  assert.ok(vy1 > vy0);
  assert.ok(vy2 > vy1);
});

test("a flap resets birdVy to FLAP_IMPULSE (hard set, not additive) even when falling fast", () => {
  let s = step(initState(), 1500, false); // let gravity build up over 1.5s in a single frame
  s = pinBird(s); // reposition mid-air regardless of where that fall left birdY, so the ground/ceiling check can't interfere
  assert.ok(s.birdVy > FLAP_IMPULSE); // falling: velocity has grown well past the impulse value

  const flapped = step(s, 16, true);
  assert.equal(flapped.birdVy, FLAP_IMPULSE);
});

test("hitting the ground sets status to dead, and further steps freeze the state", () => {
  const s = run(initState(), 200, 200); // plenty of time to fall to the ground with no flaps
  assert.equal(s.status, "dead");
  const frozen = step(s, 16, false);
  assert.equal(frozen, s); // same reference: step() is a no-op once dead
});

test("hitting the ceiling clamps the bird there instead of killing it", () => {
  let s = initState();
  // Flapping every frame is a hard vy reset to FLAP_IMPULSE each time (no gravity term),
  // so the bird climbs at a fixed rate: comfortably reaches the ceiling within 100 frames.
  for (let i = 0; i < 100; i++) s = step(s, 16, true);
  assert.equal(s.status, "flying");
  assert.equal(s.birdY, BIRD_RADIUS);
  assert.equal(s.birdVy, 0);
});

test("a pipe spawns off-screen right on the first step", () => {
  const s = step(initState(), 16, false);
  assert.equal(s.pipes.length, 1);
  assert.ok(s.pipes[0].x > CONFIG.GAME_W);
});

test("pipes scroll left over time", () => {
  let s = flying();
  const firstX = s.pipes[0].x;
  for (let i = 0; i < 5; i++) s = pinBird(step(s, 100, false));
  assert.ok(s.pipes[0].x < firstX);
});

test("a pipe fully scrolled off the left edge is removed on the next step", () => {
  let s = flying();
  s.pipes[0] = { x: -PIPE_WIDTH - 5, gapY: s.birdY, passed: true }; // already off-screen; gap doesn't matter, marked passed so it can't affect score
  s = step(s, 16, false);
  // The stale off-screen pipe must be gone (a replacement may spawn in its place the same frame,
  // since the rightmost-pipe spawn check also sees this same stale pipe as "far left").
  assert.ok(s.pipes.every((p) => p.x + PIPE_WIDTH >= 0));
});

test("passing a pipe increments score exactly once", () => {
  let s = flying();
  // Position the pipe so this frame's leftward scroll carries its trailing edge just past BIRD_X.
  s.pipes[0] = { x: BIRD_X - PIPE_WIDTH + 1, gapY: s.birdY, passed: false };
  s = pinBird(step(s, 16, false));
  assert.equal(s.score, 1);

  const after = pinBird(step(s, 16, false)); // pipe keeps scrolling; already marked passed
  assert.equal(after.score, 1);
});

test("colliding with a pipe (outside the gap) sets status to dead", () => {
  let s = flying();
  // Pipe directly under the bird's x range, gap far away from the bird's y.
  s.pipes[0] = { x: BIRD_X - PIPE_WIDTH / 2, gapY: GAME_H - 10, passed: false };
  s = step(s, 16, false);
  assert.equal(s.status, "dead");
});

test("passing through the gap does not kill the bird", () => {
  let s = flying();
  // Same x overlap, but the gap is centered right on the bird.
  s.pipes[0] = { x: BIRD_X - PIPE_WIDTH / 2, gapY: s.birdY, passed: false };
  s = step(s, 16, false);
  assert.notEqual(s.status, "dead");
});

test("difficulty ramp: t=0 matches START config values, t>=RAMP_DURATION_MS matches END config values", () => {
  const start = computeDifficulty(0);
  assert.equal(start.gravity, CONFIG.GRAVITY_START);
  assert.equal(start.pipeSpeed, CONFIG.PIPE_SPEED_START);
  assert.equal(start.gapHeight, PIPE_GAP_START);

  const end = computeDifficulty(CONFIG.RAMP_DURATION_MS);
  assert.equal(end.gravity, CONFIG.GRAVITY_END);
  assert.equal(end.pipeSpeed, CONFIG.PIPE_SPEED_END);
  assert.equal(end.gapHeight, CONFIG.PIPE_GAP_END);

  // Ramp is clamped past the duration, not extrapolated further.
  const past = computeDifficulty(CONFIG.RAMP_DURATION_MS * 2);
  assert.deepEqual(past, end);
});

test("difficulty ramp is monotonic partway through", () => {
  const mid = computeDifficulty(CONFIG.RAMP_DURATION_MS / 2);
  assert.ok(mid.gravity > CONFIG.GRAVITY_START && mid.gravity < CONFIG.GRAVITY_END);
  assert.ok(mid.pipeSpeed > CONFIG.PIPE_SPEED_START && mid.pipeSpeed < CONFIG.PIPE_SPEED_END);
  assert.ok(mid.gapHeight < CONFIG.PIPE_GAP_START && mid.gapHeight > CONFIG.PIPE_GAP_END);
});

test("bird starts within the game bounds", () => {
  const s = initState();
  assert.ok(s.birdY - BIRD_RADIUS >= 0);
  assert.ok(s.birdY + BIRD_RADIUS <= GAME_H);
});

/**
 * Flappy Human — pure game simulation: bird motion, pipe spawn/scroll,
 * collision, scoring, difficulty ramp. No React, no DOM/browser APIs, no
 * timers — a plain function of its inputs, called every animation frame by
 * Play.tsx (which owns rendering, input detection, and the state machine
 * around this).
 */
import { CONFIG } from "./config";
import { clamp } from "./math";

const {
  GAME_W,
  GAME_H,
  BIRD_X,
  BIRD_RADIUS,
  FLAP_IMPULSE,
  RAMP_DURATION_MS,
  GRAVITY_START,
  GRAVITY_END,
  PIPE_SPEED_START,
  PIPE_SPEED_END,
  PIPE_GAP_START,
  PIPE_GAP_END,
  PIPE_WIDTH,
  PIPE_SPACING,
  COLLISION_FORGIVENESS,
} = CONFIG;

/** Keeps a spawned gap's center away from the very top/bottom so it's always partially reachable. */
const PIPE_EDGE_MARGIN = 40;

export interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

export interface GameState {
  status: "flying" | "dead";
  birdY: number;
  birdVy: number;
  pipes: Pipe[];
  score: number;
  elapsedMs: number;
  /** Current pipe-gap height (from computeDifficulty), cached here so draw.ts doesn't need to recompute the ramp. */
  gapHeight: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Gravity / pipe speed / pipe gap height at a given ramp clock value, interpolated START -> END over RAMP_DURATION_MS. */
export function computeDifficulty(elapsedMs: number): {
  gravity: number;
  pipeSpeed: number;
  gapHeight: number;
} {
  const t = clamp(elapsedMs / RAMP_DURATION_MS, 0, 1);
  return {
    gravity: lerp(GRAVITY_START, GRAVITY_END, t),
    pipeSpeed: lerp(PIPE_SPEED_START, PIPE_SPEED_END, t),
    gapHeight: lerp(PIPE_GAP_START, PIPE_GAP_END, t),
  };
}

function randomGapY(gapHeight: number): number {
  const min = gapHeight / 2 + PIPE_EDGE_MARGIN;
  const max = GAME_H - gapHeight / 2 - PIPE_EDGE_MARGIN;
  if (max <= min) return GAME_H / 2;
  return min + Math.random() * (max - min);
}

/** True if the (forgiveness-shrunk) bird hitbox overlaps this pipe's body but misses its gap. */
function pipeCollides(birdY: number, pipe: Pipe, gapHeight: number): boolean {
  const birdLeft = BIRD_X - BIRD_RADIUS + COLLISION_FORGIVENESS;
  const birdRight = BIRD_X + BIRD_RADIUS - COLLISION_FORGIVENESS;
  const birdTop = birdY - BIRD_RADIUS + COLLISION_FORGIVENESS;
  const birdBottom = birdY + BIRD_RADIUS - COLLISION_FORGIVENESS;

  const overlapsX = pipe.x < birdRight && pipe.x + PIPE_WIDTH > birdLeft;
  if (!overlapsX) return false;

  const gapTop = pipe.gapY - gapHeight / 2;
  const gapBottom = pipe.gapY + gapHeight / 2;
  return birdTop < gapTop || birdBottom > gapBottom;
}

export function initState(): GameState {
  return {
    status: "flying",
    birdY: GAME_H / 2,
    birdVy: 0,
    pipes: [],
    score: 0,
    elapsedMs: 0,
    gapHeight: PIPE_GAP_START,
  };
}

export function step(state: GameState, dtMs: number, flapped: boolean): GameState {
  if (state.status === "dead") return state;

  // "flying" (the only non-dead status) — gravity applies from the very
  // first step, right after the countdown; there's no pre-flap hover phase
  // waiting for the player's first input.
  const elapsedMs = state.elapsedMs + dtMs;
  const { gravity, pipeSpeed, gapHeight } = computeDifficulty(elapsedMs);
  const dtSec = dtMs / 1000;

  const birdVy = flapped ? FLAP_IMPULSE : state.birdVy + gravity * dtSec;
  const birdY = state.birdY + birdVy * dtSec;

  let pipes = state.pipes.map((p) => ({ ...p, x: p.x - pipeSpeed * dtSec }));

  if (pipes.length === 0) {
    // First pipe gets a head start off-screen so the player has a moment before it arrives.
    pipes.push({ x: GAME_W + 100, gapY: randomGapY(gapHeight), passed: false });
  } else if (pipes[pipes.length - 1].x < GAME_W - PIPE_SPACING) {
    pipes.push({ x: GAME_W, gapY: randomGapY(gapHeight), passed: false });
  }

  pipes = pipes.filter((p) => p.x + PIPE_WIDTH >= 0);

  let score = state.score;
  pipes = pipes.map((p) => {
    if (!p.passed && p.x + PIPE_WIDTH < BIRD_X) {
      score += 1;
      return { ...p, passed: true };
    }
    return p;
  });

  const hitFloor = birdY + BIRD_RADIUS > GAME_H;
  const collided = pipes.some((p) => pipeCollides(birdY, p, gapHeight));

  if (hitFloor || collided) {
    return { status: "dead", birdY, birdVy, pipes, score, elapsedMs, gapHeight };
  }

  // The ceiling is solid but non-lethal: the bird bumps it and gravity pulls it back
  // down, unlike the floor or a pipe, which both still end the run.
  const hitCeiling = birdY - BIRD_RADIUS < 0;
  const clampedBirdY = hitCeiling ? BIRD_RADIUS : birdY;
  const clampedBirdVy = hitCeiling ? 0 : birdVy;

  return { status: "flying", birdY: clampedBirdY, birdVy: clampedBirdVy, pipes, score, elapsedMs, gapHeight };
}

/**
 * Reflex Runner — pure game simulation: lane/jump/duck state, obstacle
 * spawn/scroll, collision, scoring, difficulty ramp. No React, no DOM/browser
 * APIs, no timers — a plain function of its inputs, called every animation
 * frame by Play.tsx (which owns rendering, input detection, and the state
 * machine around this).
 */
import { CONFIG } from "./config";
import { clamp, lerp } from "./math";

const {
  LANE_SWITCH_MS,
  JUMP_DURATION_START_MS,
  JUMP_DURATION_END_MS,
  RAMP_DURATION_MS,
  SPEED_START,
  SPEED_END,
  SPACING_START,
  SPACING_END,
  DOUBLE_OBSTACLE_START_MS,
  DOUBLE_OBSTACLE_CHANCE,
  FAR_Z,
  OBSTACLE_THICKNESS,
} = CONFIG;

export type ObstacleType = "duck" | "jump" | "lane";

export interface Obstacle {
  z: number; // depth: CONFIG.FAR_Z (spawn) decreasing toward 0 (player), then negative once passed
  type: ObstacleType;
  lane: 0 | 1 | 2; // only meaningful for type "lane"
  passed: boolean;
}

export interface RunnerInput {
  lane: 0 | 1 | 2; // detector's current target lane (positional, not an event)
  ducking: boolean; // detector's current ducking hold state (positional, not an event)
  jumped: boolean; // true for exactly the one input where a jump was just triggered
}

export interface GameState {
  status: "running" | "dead";
  lane: 0 | 1 | 2;
  laneX: number; // continuous 0..2, eased toward `lane`, for rendering only
  ducking: boolean; // effective ducking state used this frame
  airborneMs: number; // >0 while mid-jump-arc, counts down to 0 each step
  airborneTotalMs: number; // this jump's full duration (ramp-dependent at the moment it started), for draw.ts's arc-progress ratio
  obstacles: Obstacle[];
  score: number;
  elapsedMs: number;
  speed: number; // current world scroll speed (from the difficulty ramp), cached for draw.ts
}

const OBSTACLE_TYPES: ObstacleType[] = ["duck", "jump", "lane"];
const PAIRABLE_WITH_LANE: ObstacleType[] = ["jump", "duck"]; // never paired with each other — can't be airborne and ducking at once

/** Scroll speed / obstacle spacing / jump duration at a given ramp clock value, interpolated over RAMP_DURATION_MS. */
export function computeDifficulty(elapsedMs: number): { speed: number; spacing: number; jumpDurationMs: number } {
  const t = clamp(elapsedMs / RAMP_DURATION_MS, 0, 1);
  return {
    speed: lerp(SPEED_START, SPEED_END, t),
    spacing: lerp(SPACING_START, SPACING_END, t),
    jumpDurationMs: lerp(JUMP_DURATION_START_MS, JUMP_DURATION_END_MS, t),
  };
}

function randomLane(): 0 | 1 | 2 {
  return Math.floor(Math.random() * 3) as 0 | 1 | 2;
}

function randomObstacle(): Obstacle {
  return {
    z: FAR_Z,
    type: OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)],
    lane: randomLane(),
    passed: false,
  };
}

/**
 * One obstacle most of the time; past DOUBLE_OBSTACLE_START_MS, sometimes a
 * pair spawned at the same z: a jump/duck hurdle + a lane barrier (jump/duck
 * it while also dodging into a safe lane), or two lane barriers in different
 * lanes (always leaves exactly one lane open, so it's always beatable).
 * Jump and duck never pair — see PAIRABLE_WITH_LANE above.
 */
export function randomObstacleGroup(elapsedMs: number): Obstacle[] {
  const shouldPair = elapsedMs >= DOUBLE_OBSTACLE_START_MS && Math.random() < DOUBLE_OBSTACLE_CHANCE;
  if (!shouldPair) return [randomObstacle()];

  if (Math.random() < 0.5) {
    const verticalType = PAIRABLE_WITH_LANE[Math.floor(Math.random() * PAIRABLE_WITH_LANE.length)];
    return [
      { z: FAR_Z, type: verticalType, lane: randomLane(), passed: false },
      { z: FAR_Z, type: "lane", lane: randomLane(), passed: false },
    ];
  }

  const laneA = randomLane();
  let laneB = randomLane();
  while (laneB === laneA) laneB = randomLane();
  return [
    { z: FAR_Z, type: "lane", lane: laneA, passed: false },
    { z: FAR_Z, type: "lane", lane: laneB, passed: false },
  ];
}

export function initState(): GameState {
  return {
    status: "running",
    lane: 1,
    laneX: 1,
    ducking: false,
    airborneMs: 0,
    airborneTotalMs: JUMP_DURATION_START_MS,
    obstacles: [],
    score: 0,
    elapsedMs: 0,
    speed: SPEED_START,
  };
}

export function step(state: GameState, dtMs: number, input: RunnerInput): GameState {
  if (state.status === "dead") return state;

  const elapsedMs = state.elapsedMs + dtMs;
  const { speed, spacing, jumpDurationMs } = computeDifficulty(elapsedMs);
  const dtSec = dtMs / 1000;

  const lane = input.lane;
  const laneX = state.laneX + (lane - state.laneX) * clamp(dtMs / LANE_SWITCH_MS, 0, 1);

  const isNewJump = input.jumped && state.airborneMs <= 0;
  const airborneMs = isNewJump ? jumpDurationMs : Math.max(0, state.airborneMs - dtMs);
  const airborneTotalMs = isNewJump ? jumpDurationMs : state.airborneTotalMs;
  const ducking = input.ducking && airborneMs <= 0;

  let obstacles = state.obstacles.map((o) => ({ ...o, z: o.z - speed * dtSec }));

  const lastObstacle = obstacles[obstacles.length - 1];
  if (!lastObstacle || lastObstacle.z < FAR_Z - spacing) {
    obstacles.push(...randomObstacleGroup(elapsedMs));
  }

  // Score before culling: PLAYER_Z is 0, the same reference point the cull
  // threshold below uses (unlike flappy-human, where the cull point is the
  // screen edge and BIRD_X is a different, positive value) — so an obstacle
  // that crosses "fully passed" this frame is also cull-eligible this same
  // frame, and would never be scored if culled first.
  let score = state.score;
  obstacles = obstacles.map((o) => {
    if (!o.passed && o.z + OBSTACLE_THICKNESS < 0) {
      score += 1;
      return { ...o, passed: true };
    }
    return o;
  });

  const collided = obstacles.some((o) => {
    const atPlayer = o.z <= 0 && o.z + OBSTACLE_THICKNESS >= 0;
    if (!atPlayer) return false;
    if (o.type === "duck") return !ducking;
    if (o.type === "jump") return !(airborneMs > 0);
    return lane === o.lane; // "lane": collision when the player shares the blocked lane
  });

  obstacles = obstacles.filter((o) => o.z + OBSTACLE_THICKNESS >= 0);

  if (collided) {
    return { status: "dead", lane, laneX, ducking, airborneMs, airborneTotalMs, obstacles, score, elapsedMs, speed };
  }

  return { status: "running", lane, laneX, ducking, airborneMs, airborneTotalMs, obstacles, score, elapsedMs, speed };
}

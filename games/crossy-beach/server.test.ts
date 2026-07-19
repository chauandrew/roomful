/**
 * Crossy Beach server logic tests. Run with: npm run test:crossy-beach
 *
 * The reducer is deterministic given a seed, so every test overwrites the
 * Math.random()-picked seed right after init() (state is plain data) and
 * drives time exclusively through { type: "tick", dtMs } host actions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Player } from "../../lib/types";
import {
  COLS,
  HOP_COOLDOWN_MS,
  LEVELS,
  LEVEL_INTRO_MS,
  MAX_DT_MS,
  PLAYER_COOLDOWN_MS,
  RESPAWN_INVULN_MS,
  START_LIVES,
  TICK_MS,
  type CrossyBeachHostAction,
  type Dir,
  type LaneKind,
  type PlayerViewData,
} from "./config";
import { crossyBeachLogic, type Lane, type CrossyBeachState } from "./server";

const CENTER = Math.floor(COLS / 2); // 6

function mkPlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, connected: true }));
}

/** Advance the reducer clock by `ms` in TICK_MS steps. */
function tick(state: CrossyBeachState, players: Player[], ms: number): CrossyBeachState {
  let s = state;
  for (let i = 0; i < Math.round(ms / TICK_MS); i++) {
    s = crossyBeachLogic.onHostAction(s, { type: "tick", dtMs: TICK_MS }, players);
  }
  return s;
}

function mkInit(n: number, seed = 1234): { state: CrossyBeachState; players: Player[] } {
  const players = mkPlayers(n);
  return { state: { ...crossyBeachLogic.init(players), seed }, players };
}

/** Deterministic state just past the level-0 intro, phase "running". */
function mkRunning(n = 4, seed = 1234): { state: CrossyBeachState; players: Player[] } {
  const { state, players } = mkInit(n, seed);
  return { state: tick(state, players, LEVEL_INTRO_MS), players };
}

function lane(kind: LaneKind, over: Partial<Lane> = {}): Lane {
  return { kind, emoji: "", dir: 1, speed: 0, len: 1, entities: [], period: 0, duty: 0, offset: 0, ...over };
}

function withLane(state: CrossyBeachState, row: number, l: Lane): CrossyBeachState {
  const lanes = [...state.lanes];
  lanes[row] = l;
  return { ...state, lanes };
}

function withTurtle(state: CrossyBeachState, over: Partial<CrossyBeachState["turtle"]>): CrossyBeachState {
  return { ...state, turtle: { ...state.turtle, ...over } };
}

function hop(state: CrossyBeachState, players: Player[], playerId: string, dir: Dir): CrossyBeachState {
  return crossyBeachLogic.onPlayerInput(state, playerId, { dir }, players);
}

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

// ── control assignment ──────────────────────────────────────────────────────

test("control table: 2 players", () => {
  const { state } = mkInit(2);
  assert.deepEqual(state.controls, { up: ["p0"], right: ["p0"], down: ["p1"], left: ["p1"] });
});

test("control table: 3 players", () => {
  const { state } = mkInit(3);
  assert.deepEqual(state.controls, { up: ["p0"], down: ["p0"], left: ["p1"], right: ["p2"] });
});

test("control table: 4 players", () => {
  const { state } = mkInit(4);
  assert.deepEqual(state.controls, { up: ["p0"], left: ["p1"], right: ["p2"], down: ["p3"] });
});

test("control table: 6 players doubles up dirs in [up,left,right,down] order", () => {
  const { state } = mkInit(6);
  assert.deepEqual(state.controls, {
    up: ["p0", "p4"],
    left: ["p1", "p5"],
    right: ["p2"],
    down: ["p3"],
  });
});

// ── input gating ────────────────────────────────────────────────────────────

test("input from a non-owner is ignored", () => {
  const { state, players } = mkRunning(4);
  const next = hop(state, players, "p1", "up"); // p1 owns left, not up
  assert.equal(next, state);
});

test("input during level-intro is ignored", () => {
  const { state, players } = mkInit(4);
  assert.equal(hop(state, players, "p0", "up"), state);
});

test("input during the respawn input lock is ignored", () => {
  const { state, players } = mkRunning(4);
  const locked = withTurtle(state, { inputLockUntilMs: state.timeMs + 400 });
  assert.equal(hop(locked, players, "p0", "up"), locked);
});

test("cooldowns: shared turtle cooldown plus 300ms per-player cooldown", () => {
  const { state, players } = mkRunning(4);
  let s = hop(state, players, "p1", "left");
  assert.equal(s.turtle.x, CENTER - 1);
  assert.equal(hop(s, players, "p1", "left"), s); // same timeMs: both cooldowns block
  s = tick(s, players, TICK_MS); // past the shared cooldown (TICK_MS >= HOP_COOLDOWN_MS)…
  assert.ok(TICK_MS >= HOP_COOLDOWN_MS);
  assert.equal(hop(s, players, "p1", "left"), s); // …but p1 is still inside their 300ms
  s = hop(s, players, "p2", "right"); // a teammate is NOT blocked by p1's cooldown
  assert.equal(s.turtle.x, CENTER);
  s = tick(s, players, TICK_MS * 2); // p1 now past PLAYER_COOLDOWN_MS
  assert.ok(TICK_MS * 3 >= PLAYER_COOLDOWN_MS);
  s = hop(s, players, "p1", "left");
  assert.equal(s.turtle.x, CENTER - 1);
});

test("edge clamping: left at col 0, right at col COLS-1, down at row 0", () => {
  const { state, players } = mkRunning(4);
  const atLeft = hop(withTurtle(state, { x: 0 }), players, "p1", "left");
  assert.equal(atLeft.turtle.x, 0);
  assert.equal(atLeft.stats.p1.hops, 1); // the hop was accepted, just clamped
  const atRight = hop(withTurtle(state, { x: COLS - 1 }), players, "p2", "right");
  assert.equal(atRight.turtle.x, COLS - 1);
  const atBottom = hop(state, players, "p3", "down");
  assert.equal(atBottom.turtle.row, 0);
});

// ── deaths & respawn ────────────────────────────────────────────────────────

test("traffic overlap in a tick kills, respawns at row 0 with invulnerability", () => {
  const { state, players } = mkRunning(2);
  let s = withLane(state, 2, lane("traffic", { speed: 1, entities: [CENTER] }));
  s = withTurtle(s, { row: 2 }); // center 6.5 inside (6, 7)
  const next = tick(s, players, TICK_MS);
  assert.equal(next.lives, START_LIVES - 1);
  assert.equal(next.totalDeaths, 1);
  assert.equal(next.turtle.row, 0);
  assert.equal(next.turtle.x, CENTER);
  assert.equal(next.turtle.invulnUntilMs, next.timeMs + RESPAWN_INVULN_MS);
  assert.equal(next.sound?.kind, "splat");
  assert.equal(next.timerEndsAtMs, next.timeMs + LEVELS[0].timerMs);
});

test("invulnerability window prevents a death, and expires", () => {
  const { state, players } = mkRunning(2);
  let s = withLane(state, 2, lane("traffic", { speed: 0, entities: [CENTER] }));
  s = withTurtle(s, { row: 2, invulnUntilMs: s.timeMs + 10_000 });
  const safe = tick(s, players, TICK_MS * 4);
  assert.equal(safe.lives, START_LIVES);
  assert.equal(safe.turtle.row, 2);
  s = withTurtle(s, { invulnUntilMs: 0 });
  const dead = tick(s, players, TICK_MS);
  assert.equal(dead.lives, START_LIVES - 1);
});

test("hopping into traffic kills via onPlayerInput", () => {
  const { state, players } = mkRunning(4);
  const s = withLane(state, 1, lane("traffic", { entities: [CENTER - 0.4] }));
  const next = hop(s, players, "p0", "up"); // lands at x=6, center 6.5 in (5.6, 6.6)
  assert.equal(next.lives, START_LIVES - 1);
  assert.equal(next.turtle.row, 0);
  assert.equal(next.sound?.kind, "splat");
  assert.equal(next.stats.p0.hops, 1); // the hop still counted
});

// ── water ───────────────────────────────────────────────────────────────────

test("riding a water entity drifts the turtle with the lane", () => {
  const { state, players } = mkRunning(2);
  let s = withLane(state, 1, lane("water", { speed: 2, dir: 1, len: 3, entities: [5] }));
  s = withTurtle(s, { row: 1 }); // center 6.5 inside (5, 8)
  const next = tick(s, players, TICK_MS);
  approx(next.turtle.x, CENTER + 0.25); // 2 cells/s * 0.125s
  approx(next.lanes[1].entities[0], 5.25);
  assert.equal(next.lives, START_LIVES);
});

test("drifting off the edge sweeps the turtle to its death", () => {
  const { state, players } = mkRunning(2);
  let s = withLane(state, 1, lane("water", { speed: 2, dir: 1, len: 3, entities: [11] }));
  s = withTurtle(s, { row: 1, x: 12.4 }); // one drift step pushes center past COLS
  const next = tick(s, players, TICK_MS);
  assert.equal(next.lives, START_LIVES - 1);
  assert.equal(next.sound?.kind, "splash");
});

test("hopping into open water kills", () => {
  const { state, players } = mkRunning(4);
  const s = withLane(state, 1, lane("water", { speed: 2, len: 1, entities: [0] }));
  const next = hop(s, players, "p0", "up"); // lands at col 6, no kelp underfoot
  assert.equal(next.lives, START_LIVES - 1);
  assert.equal(next.sound?.kind, "splash");
  assert.equal(next.turtle.row, 0);
});

// ── waves ───────────────────────────────────────────────────────────────────

test("wave row kills exactly when ((t + offset) mod period) < duty*period", () => {
  const { state, players } = mkRunning(2);
  // period 4, duty 0.35, offset 1.3: lethal window opens at t = 2.7s.
  let s = withLane(state, 1, lane("wave", { period: 4, duty: 0.35, offset: 1.3 }));
  s = withTurtle(s, { row: 1 }); // timeMs = 2500 -> (2.5+1.3)%4 = 3.8, safe
  s = tick(s, players, TICK_MS); // 2625 -> 3.925, still safe
  assert.equal(s.lives, START_LIVES);
  s = tick(s, players, TICK_MS); // 2750 -> 0.05 < 1.4, lethal
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.sound?.kind, "splash");
});

// ── birds ───────────────────────────────────────────────────────────────────

/** Running state on a birds level (config from LEVELS[1]), turtle safe at row 0. */
function mkBirdState(): { state: CrossyBeachState; players: Player[] } {
  const { state, players } = mkRunning(2);
  // nextBirdAtMs stayed 0 (level 0 has no birds), so a bird spawns next tick.
  return { state: { ...state, level: 1 }, players };
}

test("bird spawns targeting the turtle's row and col", () => {
  const { state, players } = mkBirdState();
  const s = tick(state, players, TICK_MS);
  assert.equal(s.birds.length, 1);
  assert.equal(s.birds[0].row, 0);
  assert.equal(s.birds[0].col, CENTER);
  assert.equal(s.birds[0].strikesAtMs, s.timeMs + LEVELS[1].birds!.telegraphMs);
  assert.ok(s.nextBirdAtMs >= s.timeMs + LEVELS[1].birds!.intervalMs * 0.7);
  assert.ok(s.nextBirdAtMs <= s.timeMs + LEVELS[1].birds!.intervalMs * 1.3);
});

test("bird strike on the turtle's cell kills", () => {
  const { state, players } = mkBirdState();
  let s = tick(state, players, TICK_MS); // spawn
  s = tick(s, players, LEVELS[1].birds!.telegraphMs); // reach strikesAtMs
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.sound?.kind, "peck");
  assert.equal(s.birds.length, 0); // respawn clears birds
});

test("bird strike misses if the turtle moved, bird lingers then despawns", () => {
  const { state, players } = mkBirdState();
  let s = tick(state, players, TICK_MS); // spawn targeting col 6
  s = withTurtle(s, { x: 2 });
  s = tick(s, players, LEVELS[1].birds!.telegraphMs);
  assert.equal(s.lives, START_LIVES);
  assert.equal(s.birds[0]?.struck, true);
  s = tick(s, players, 500); // past BIRD_LINGER_MS
  assert.equal(s.birds.length, 0);
});

test("no bird spawns while the turtle is invulnerable", () => {
  const { state, players } = mkBirdState();
  const s = tick(withTurtle(state, { invulnUntilMs: state.timeMs + 5000 }), players, TICK_MS * 8);
  assert.equal(s.birds.length, 0);
});

// ── tide timer ──────────────────────────────────────────────────────────────

test("timer expiry costs a life and resets the timer", () => {
  const { state, players } = mkRunning(2);
  const s = tick({ ...state, timerEndsAtMs: state.timeMs }, players, TICK_MS);
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(s.sound?.kind, "timeout");
  assert.equal(s.timerEndsAtMs, s.timeMs + LEVELS[0].timerMs);
});

// ── level progression ───────────────────────────────────────────────────────

test("reaching the top row advances the level, rotates controls, clears birds", () => {
  const { state, players } = mkRunning(4);
  let s = withTurtle(state, { row: 12 }); // level-0 row 12 is safe
  s = { ...s, birds: [{ row: 3, col: 3, width: 1, emoji: "b", spawnedAtMs: 0, strikesAtMs: 9e9, struck: false }] };
  const next = hop(s, players, "p0", "up");
  assert.equal(next.level, 1);
  assert.equal(next.phase, "level-intro");
  assert.equal(next.introUntilMs, next.timeMs + LEVEL_INTRO_MS);
  assert.equal(next.sound?.kind, "levelup");
  assert.deepEqual(next.birds, []);
  assert.equal(next.turtle.row, 0);
  assert.equal(next.turtle.x, CENTER);
  // Seat i+1 takes seat i's dir-set.
  assert.deepEqual(next.controls, { up: ["p1"], left: ["p2"], right: ["p3"], down: ["p0"] });
});

test("finishing the last level wins the game", () => {
  const { state, players } = mkRunning(2);
  const s = withTurtle({ ...state, level: 3 }, { row: 12 });
  const next = hop(s, players, "p0", "up");
  assert.equal(next.phase, "won");
  assert.equal(next.sound?.kind, "win");
});

test("losing the last life ends the game, and ticks are then ignored", () => {
  const { state, players } = mkRunning(2);
  let s = withLane({ ...state, lives: 1 }, 2, lane("traffic", { entities: [CENTER] }));
  s = withTurtle(s, { row: 2 });
  s = tick(s, players, TICK_MS);
  assert.equal(s.phase, "gameover");
  assert.equal(s.lives, 0);
  assert.equal(s.sound?.kind, "gameover");
  assert.equal(tick(s, players, TICK_MS), s);
});

test("play-again resets to a playable level-0 state, keeping seats and controls", () => {
  const { state, players } = mkRunning(2);
  let s = withLane({ ...state, lives: 1 }, 2, lane("traffic", { entities: [CENTER] }));
  s = withTurtle(s, { row: 2 });
  s = tick(s, players, TICK_MS);
  assert.equal(s.phase, "gameover");
  const again = crossyBeachLogic.onHostAction(s, { type: "play-again" }, players);
  assert.equal(again.phase, "level-intro");
  assert.equal(again.level, 0);
  assert.equal(again.lives, START_LIVES);
  assert.equal(again.timeMs, 0);
  assert.equal(again.totalDeaths, 0);
  assert.deepEqual(again.stats, { p0: { hops: 0 }, p1: { hops: 0 } });
  assert.deepEqual(again.controls, s.controls);
  assert.deepEqual(again.seatIds, s.seatIds);
  // Deterministically playable: intro elapses into "running" again.
  const back = tick(again, players, LEVEL_INTRO_MS);
  assert.equal(back.phase, "running");
});

test("play-again is ignored mid-game", () => {
  const { state, players } = mkRunning(2);
  assert.equal(crossyBeachLogic.onHostAction(state, { type: "play-again" }, players), state);
});

// ── disconnect safety ───────────────────────────────────────────────────────

test("a dir whose owners are all disconnected is lent to a connected player", () => {
  const { state, players } = mkRunning(4);
  const dropped = players.map((p) => (p.id === "p0" ? { ...p, connected: false } : p));
  const view = crossyBeachLogic.playerView(state, "p1", dropped) as PlayerViewData;
  assert.deepEqual(view.dirs, ["up", "left"]); // p1 (fewest dirs, first in order) covers up
  const next = hop(state, dropped, "p1", "up");
  assert.equal(next.turtle.row, 1);
  // Reconnection restores the base mapping (nothing was stored).
  const restored = crossyBeachLogic.playerView(state, "p1", players) as PlayerViewData;
  assert.deepEqual(restored.dirs, ["left"]);
});

test("a single connected player ends up owning all four dirs", () => {
  const { state, players } = mkRunning(4);
  const soloed = players.map((p) => (p.id === "p0" ? p : { ...p, connected: false }));
  const view = crossyBeachLogic.playerView(state, "p0", soloed) as PlayerViewData;
  assert.deepEqual([...view.dirs].sort(), ["down", "left", "right", "up"]);
});

// ── clock ───────────────────────────────────────────────────────────────────

test("a huge dt is clamped to MAX_DT_MS", () => {
  const { state, players } = mkRunning(2);
  const before = state.lanes[2].entities[0];
  const next = crossyBeachLogic.onHostAction(state, { type: "tick", dtMs: 10_000 }, players);
  assert.equal(next.timeMs, state.timeMs + MAX_DT_MS);
  // Level-0 row 2 traffic moved 0.25s worth, not 10s worth.
  approx(next.lanes[2].entities[0], before + LEVELS[0].rows[2].speed! * (MAX_DT_MS / 1000));
});

test("a malformed dtMs (NaN, missing, non-numeric) is treated as a no-op tick, not propagated", () => {
  const { state, players } = mkRunning(2);
  for (const badDt of [NaN, undefined, "100", {}, [1, 2]] as unknown as number[]) {
    const next = crossyBeachLogic.onHostAction(state, { type: "tick", dtMs: badDt }, players);
    assert.equal(next.timeMs, state.timeMs, `dtMs=${String(badDt)} must not advance the clock`);
    assert.ok(Number.isFinite(next.timeMs), `dtMs=${String(badDt)} must not leave timeMs as NaN`);
  }
});

test("a null or non-object host action is ignored, not thrown", () => {
  const { state, players } = mkRunning(2);
  for (const bad of [null, undefined, "tick", 42] as unknown as CrossyBeachHostAction[]) {
    assert.equal(crossyBeachLogic.onHostAction(state, bad, players), state);
  }
});

test("lanes move during the level intro", () => {
  const { state, players } = mkInit(2);
  const next = tick(state, players, TICK_MS);
  assert.equal(next.phase, "level-intro");
  approx(next.lanes[2].entities[0], LEVELS[0].rows[2].speed! * (TICK_MS / 1000));
});

/**
 * Crossy Beach — server logic. Co-op Frogger: one shared baby turtle, each
 * player owns 1-2 direction buttons, four hand-authored levels (config.LEVELS)
 * crossed bottom (row 0) to top (row ROWS-1).
 *
 * The HostView drives time by sending { type: "tick", dtMs } host actions;
 * there is no other clock, so every method is a pure function of its inputs.
 * The only Math.random() call is in init() to pick a seed — all later
 * randomness comes from a mulberry32 PRNG addressed by a cursor stored in
 * state, keeping the reducer deterministic for tests.
 *
 * NOTE: no React imports, and value imports stay relative — this file is
 * bundled into the PartyKit worker.
 */
import type { Player } from "../../lib/types";
import type { MultiUserGameLogic } from "../types";
import {
  BIRD_LINGER_MS,
  COLS,
  DIRS,
  HOP_COOLDOWN_MS,
  LEVELS,
  LEVEL_INTRO_MS,
  MAX_DT_MS,
  PLAYER_COOLDOWN_MS,
  RESPAWN_INPUT_LOCK_MS,
  RESPAWN_INVULN_MS,
  ROWS,
  START_LIVES,
  WAVE_RECEDE_MS,
  WAVE_WARNING_MS,
  type Dir,
  type HostViewData,
  type LaneKind,
  type PlayerViewData,
  type CrossyBeachHostAction,
  type CrossyBeachInput,
  type CrossyBeachPhase,
  type SoundKind,
} from "./config";

// ── state ───────────────────────────────────────────────────────────────────

interface Turtle {
  row: number;
  /** Fractional left-edge column; the turtle's center is x + 0.5. */
  x: number;
  lastHopMs: number;
  invulnUntilMs: number;
  inputLockUntilMs: number;
}

export interface Lane {
  kind: LaneKind;
  emoji: string;
  dir: 1 | -1;
  speed: number;
  len: number;
  /** Fractional left-edge x per entity, wrapped into [-len, COLS]. */
  entities: number[];
  period: number;
  duty: number;
  offset: number;
}

export interface Bird {
  row: number;
  col: number;
  width: number;
  emoji: string;
  spawnedAtMs: number;
  strikesAtMs: number;
  struck: boolean;
}

export interface CrossyBeachState {
  phase: CrossyBeachPhase;
  level: number;
  /** Game clock, advanced only by host tick actions (dt clamped to MAX_DT_MS). */
  timeMs: number;
  introUntilMs: number;
  timerEndsAtMs: number;
  turtle: Turtle;
  lanes: Lane[];
  birds: Bird[];
  nextBirdAtMs: number;
  lives: number;
  /** Seat order frozen at init; control rotation walks this list. */
  seatIds: string[];
  /**
   * Base button ownership (dir -> playerIds). Disconnect fill-ins are
   * derived on demand via mergedControls(), never stored — so a
   * reconnection restores the original mapping automatically.
   */
  controls: Record<Dir, string[]>;
  stats: Record<string, { hops: number }>;
  /** playerId -> timeMs of their last ACCEPTED press, for the per-player cooldown. */
  lastInputAtMs: Record<string, number>;
  totalDeaths: number;
  /** Latest sound event; views play `kind` whenever `id` increases. */
  sound: { id: number; kind: SoundKind } | null;
  seed: number;
  /** PRNG values consumed so far — keeps randomness deterministic AND serializable. */
  rngCursor: number;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const CENTER_COL = Math.floor(COLS / 2);
/** Seat-rotation order (differs from config.DIRS on purpose — see spec). */
const SEAT_DIRS: Dir[] = ["up", "left", "right", "down"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** mulberry32 evaluated at a cursor position, so the PRNG lives in plain state. */
function randAt(seed: number, cursor: number): number {
  const a = (seed + Math.imul(cursor + 1, 0x6d2b79f5)) | 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Wrap an entity's left edge into [-len, COLS) over the span COLS + len. */
function wrapX(x: number, len: number): number {
  const span = COLS + len;
  return ((((x + len) % span) + span) % span) - len;
}

function buildLanes(level: number): Lane[] {
  return LEVELS[level].rows.map((t) => {
    const len = t.len ?? 1;
    const count = t.count ?? 0;
    return {
      kind: t.kind,
      emoji: t.emoji ?? "",
      dir: t.dir ?? 1,
      speed: t.speed ?? 0,
      len,
      // Spread evenly over the wrap span so gaps stay even as lanes wrap.
      entities: Array.from({ length: count }, (_, j) => wrapX((j * (COLS + len)) / count, len)),
      period: t.period ?? 0,
      duty: t.duty ?? 0,
      offset: t.offset ?? 0,
    };
  });
}

function newTurtle(): Turtle {
  return {
    row: 0,
    x: CENTER_COL,
    lastHopMs: -HOP_COOLDOWN_MS,
    invulnUntilMs: 0,
    inputLockUntilMs: 0,
  };
}

/** Turtle center sits strictly inside an entity's [x, x+len) footprint. */
function onEntity(lane: Lane, turtleX: number): boolean {
  const center = turtleX + 0.5;
  return lane.entities.some((e) => e < center && center < e + lane.len);
}

function waveActive(lane: Lane, timeMs: number): boolean {
  const cyc = (((timeMs / 1000 + lane.offset) % lane.period) + lane.period) % lane.period;
  return cyc < lane.duty * lane.period;
}

function assignControls(ids: string[]): Record<Dir, string[]> {
  const controls: Record<Dir, string[]> = { up: [], down: [], left: [], right: [] };
  const give = (seat: number, dir: Dir) => controls[dir].push(ids[seat]);
  if (ids.length === 2) {
    give(0, "up");
    give(0, "right");
    give(1, "down");
    give(1, "left");
  } else if (ids.length === 3) {
    give(0, "up");
    give(0, "down");
    give(1, "left");
    give(2, "right");
  } else {
    for (let i = 0; i < ids.length; i++) give(i, SEAT_DIRS[i % 4]);
  }
  return controls;
}

/** Each seat takes the dir-set the previous seat had (the level-up party mechanic). */
function rotateControls(controls: Record<Dir, string[]>, seatIds: string[]): Record<Dir, string[]> {
  const seatOf = new Map(seatIds.map((id, i) => [id, i]));
  const out: Record<Dir, string[]> = { up: [], down: [], left: [], right: [] };
  for (const dir of DIRS) {
    out[dir] = controls[dir].map((pid) => seatIds[((seatOf.get(pid) ?? 0) + 1) % seatIds.length]);
  }
  return out;
}

/**
 * Disconnect safety: any dir whose owners are all disconnected temporarily
 * gains the connected player with the fewest owned dirs. Derived fresh every
 * call, so reconnection restores the base mapping and the game stays
 * winnable with a single connected player.
 */
function mergedControls(controls: Record<Dir, string[]>, players: Player[]): Record<Dir, string[]> {
  const connected = players.filter((p) => p.connected).map((p) => p.id);
  if (connected.length === 0) return controls;
  const merged: Record<Dir, string[]> = {
    up: [...controls.up],
    down: [...controls.down],
    left: [...controls.left],
    right: [...controls.right],
  };
  for (const dir of DIRS) {
    if (merged[dir].some((id) => connected.includes(id))) continue;
    let best = connected[0];
    let bestCount = Infinity;
    for (const id of connected) {
      const count = DIRS.filter((d) => merged[d].includes(id)).length;
      if (count < bestCount) {
        best = id;
        bestCount = count;
      }
    }
    merged[dir] = [...merged[dir], best];
  }
  return merged;
}

/** Shallow-clone the mutable parts so handlers can build the next state in place. */
function clone(state: CrossyBeachState): CrossyBeachState {
  return {
    ...state,
    turtle: { ...state.turtle },
    lanes: state.lanes.map((l) => ({ ...l, entities: [...l.entities] })),
    birds: state.birds.map((b) => ({ ...b })),
    stats: { ...state.stats },
  };
}

function pushSound(s: CrossyBeachState, kind: SoundKind): { id: number; kind: SoundKind } {
  return { id: (s.sound?.id ?? 0) + 1, kind };
}

function isInvuln(s: CrossyBeachState): boolean {
  return s.timeMs < s.turtle.invulnUntilMs;
}

/** Apply a death to a working copy: gameover at 0 lives, otherwise respawn. */
function died(s: CrossyBeachState, kind: SoundKind): CrossyBeachState {
  s.totalDeaths += 1;
  s.lives -= 1;
  if (s.lives === 0) {
    s.phase = "gameover";
    s.sound = pushSound(s, "gameover");
    return s;
  }
  s.sound = pushSound(s, kind);
  s.turtle = {
    ...s.turtle,
    row: 0,
    x: CENTER_COL,
    invulnUntilMs: s.timeMs + RESPAWN_INVULN_MS,
    inputLockUntilMs: s.timeMs + RESPAWN_INPUT_LOCK_MS,
  };
  s.birds = [];
  s.timerEndsAtMs = s.timeMs + LEVELS[s.level].timerMs;
  return s;
}

/** Turtle reached the goal row: advance (rotating controls) or win. */
function levelComplete(s: CrossyBeachState): CrossyBeachState {
  if (s.level === LEVELS.length - 1) {
    s.phase = "won";
    s.sound = pushSound(s, "win");
    return s;
  }
  s.level += 1;
  s.lanes = buildLanes(s.level);
  s.birds = [];
  s.turtle = newTurtle();
  s.phase = "level-intro";
  s.introUntilMs = s.timeMs + LEVEL_INTRO_MS;
  s.controls = rotateControls(s.controls, s.seatIds);
  s.sound = pushSound(s, "levelup");
  return s;
}

function tick(state: CrossyBeachState, dtMs: number): CrossyBeachState {
  if (state.phase === "won" || state.phase === "gameover") return state;
  // dtMs is client-supplied (the host tab computes it from Date.now() deltas)
  // and arrives as `unknown` off the wire — Math.min/max don't filter NaN, so
  // a missing/non-numeric value would otherwise poison timeMs permanently.
  const dt = Number.isFinite(dtMs) ? clamp(dtMs, 0, MAX_DT_MS) : 0;
  const s = clone(state);
  s.timeMs += dt;

  // Lanes keep moving during the intro so the board is alive behind the banner.
  for (const lane of s.lanes) {
    if (lane.speed && lane.entities.length) {
      lane.entities = lane.entities.map((x) => wrapX(x + lane.dir * lane.speed * (dt / 1000), lane.len));
    }
  }

  if (s.phase === "level-intro") {
    if (s.timeMs < s.introUntilMs) return s;
    s.phase = "running";
    s.timerEndsAtMs = s.timeMs + LEVELS[s.level].timerMs;
    const birdCfg = LEVELS[s.level].birds;
    if (birdCfg) {
      s.nextBirdAtMs = s.timeMs + birdCfg.intervalMs * (0.7 + 0.6 * randAt(s.seed, s.rngCursor++));
    }
  }

  // Riding a water entity drifts the turtle with the lane.
  const lane = s.lanes[s.turtle.row];
  if (lane.kind === "water" && onEntity(lane, s.turtle.x)) {
    s.turtle.x += lane.dir * lane.speed * (dt / 1000);
  }

  if (!isInvuln(s)) {
    const center = s.turtle.x + 0.5;
    if (center < 0 || center > COLS) return died(s, "splash");
    if (lane.kind === "traffic" && onEntity(lane, s.turtle.x)) return died(s, "splat");
    if (lane.kind === "water" && !onEntity(lane, s.turtle.x)) return died(s, "splash");
    if (lane.kind === "wave" && waveActive(lane, s.timeMs)) return died(s, "splash");
  }

  const birdCfg = LEVELS[s.level].birds;
  if (birdCfg) {
    if (s.timeMs >= s.nextBirdAtMs && !isInvuln(s)) {
      s.birds.push({
        row: s.turtle.row,
        col: clamp(Math.round(s.turtle.x), 0, COLS - 1),
        width: birdCfg.width,
        emoji: birdCfg.emoji,
        spawnedAtMs: s.timeMs,
        strikesAtMs: s.timeMs + birdCfg.telegraphMs,
        struck: false,
      });
      s.nextBirdAtMs = s.timeMs + birdCfg.intervalMs * (0.7 + 0.6 * randAt(s.seed, s.rngCursor++));
    }
    for (const bird of s.birds) {
      if (bird.struck || s.timeMs < bird.strikesAtMs) continue;
      bird.struck = true;
      const turtleCol = Math.round(s.turtle.x);
      const hit = bird.row === s.turtle.row && Math.abs(turtleCol - bird.col) <= Math.floor(bird.width / 2);
      if (hit && !isInvuln(s)) return died(s, "peck");
    }
    s.birds = s.birds.filter((b) => s.timeMs < b.strikesAtMs + BIRD_LINGER_MS);
  }

  if (s.timeMs >= s.timerEndsAtMs) return died(s, "timeout");
  return s;
}

// ── logic ───────────────────────────────────────────────────────────────────

export const crossyBeachLogic: MultiUserGameLogic<
  CrossyBeachState,
  CrossyBeachHostAction,
  CrossyBeachInput
> = {
  init(players) {
    const ids = players.map((p) => p.id);
    return {
      phase: "level-intro",
      level: 0,
      timeMs: 0,
      introUntilMs: LEVEL_INTRO_MS,
      timerEndsAtMs: 0,
      turtle: newTurtle(),
      lanes: buildLanes(0),
      birds: [],
      nextBirdAtMs: 0,
      lives: START_LIVES,
      seatIds: ids,
      controls: assignControls(ids),
      stats: Object.fromEntries(ids.map((id) => [id, { hops: 0 }])),
      lastInputAtMs: {},
      totalDeaths: 0,
      sound: null,
      // The one allowed Math.random(): everything downstream uses seed+cursor.
      seed: Math.floor(Math.random() * 4294967296) >>> 0,
      rngCursor: 0,
    };
  },

  onHostAction(state, action) {
    // `action` arrives as `unknown` off the wire — a malformed payload
    // (e.g. a null game-action wrapper) must not throw and take the message
    // handler down with it.
    if (!action || typeof action !== "object") return state;
    if (action.type === "tick") return tick(state, action.dtMs);

    if (action.type === "play-again") {
      if (state.phase !== "won" && state.phase !== "gameover") return state;
      // Retrying at the current level only makes sense after a loss (`won`
      // already cleared every level); anything malformed/out-of-range falls
      // back to a full restart.
      const atLevel = action.atLevel;
      const level =
        state.phase === "gameover" &&
        typeof atLevel === "number" &&
        Number.isInteger(atLevel) &&
        atLevel >= 0 &&
        atLevel < LEVELS.length
          ? atLevel
          : 0;
      return {
        ...state,
        phase: "level-intro",
        level,
        timeMs: 0,
        introUntilMs: LEVEL_INTRO_MS,
        timerEndsAtMs: 0,
        turtle: newTurtle(),
        lanes: buildLanes(level),
        birds: [],
        nextBirdAtMs: 0,
        lives: START_LIVES,
        stats: Object.fromEntries(state.seatIds.map((id) => [id, { hops: 0 }])),
        lastInputAtMs: {},
        totalDeaths: 0,
        // Keep the sound object so its id stays monotonic across restarts.
        seed: Math.floor(randAt(state.seed, state.rngCursor) * 4294967296) >>> 0,
        rngCursor: 0,
      };
    }

    // Dev-only: HostView doesn't render the button that sends this in
    // production builds.
    if (action.type === "skip-level") {
      if (state.phase !== "running" && state.phase !== "level-intro") return state;
      return levelComplete(clone(state));
    }

    return state;
  },

  onPlayerInput(state, playerId, input, players) {
    if (state.phase !== "running") return state;
    const dir = input?.dir;
    if (!dir || !DIRS.includes(dir)) return state;
    if (!mergedControls(state.controls, players)[dir].includes(playerId)) return state;
    if (state.timeMs < state.turtle.inputLockUntilMs) return state;
    if (state.timeMs - state.turtle.lastHopMs < HOP_COOLDOWN_MS) return state;
    // Per-player anti-spam: each person waits PLAYER_COOLDOWN_MS between
    // accepted presses; teammates are unaffected.
    const lastInput = state.lastInputAtMs[playerId];
    if (lastInput !== undefined && state.timeMs - lastInput < PLAYER_COOLDOWN_MS) return state;

    const s = clone(state);
    let row = s.turtle.row;
    let x = Math.round(s.turtle.x);
    if (dir === "up") row += 1;
    if (dir === "down") row = Math.max(0, row - 1);
    if (dir === "left") x -= 1;
    if (dir === "right") x += 1;
    s.turtle.row = row;
    s.turtle.x = clamp(x, 0, COLS - 1);
    s.turtle.lastHopMs = s.timeMs;
    s.lastInputAtMs = { ...s.lastInputAtMs, [playerId]: s.timeMs };
    s.stats[playerId] = { hops: (s.stats[playerId]?.hops ?? 0) + 1 };
    s.sound = pushSound(s, "hop");

    if (row === ROWS - 1) return levelComplete(s);

    if (!isInvuln(s)) {
      const lane = s.lanes[row];
      if (lane.kind === "traffic" && onEntity(lane, s.turtle.x)) return died(s, "splat");
      if (lane.kind === "water" && !onEntity(lane, s.turtle.x)) return died(s, "splash");
      if (lane.kind === "wave" && waveActive(lane, s.timeMs)) return died(s, "splash");
    }
    return s;
  },

  hostView(state, players): HostViewData {
    const cfg = LEVELS[state.level];
    const merged = mergedControls(state.controls, players);
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";
    return {
      phase: state.phase,
      level: state.level,
      levelName: cfg.name,
      tagline: cfg.tagline,
      lanes: state.lanes.map((l) => {
        if (l.kind !== "wave") {
          return { kind: l.kind, emoji: l.emoji, len: l.len, entities: l.entities };
        }
        const cyc =
          (((state.timeMs / 1000 + l.offset) % l.period) + l.period) % l.period / l.period;
        // Warning = the last WAVE_WARNING_MS before the flood; recede = the
        // first WAVE_RECEDE_MS after it. Both cosmetic only — lethality stays
        // exactly waveActive().
        const warnSpan = WAVE_WARNING_MS / 1000 / l.period;
        const recedeSpan = WAVE_RECEDE_MS / 1000 / l.period;
        return {
          kind: l.kind,
          emoji: l.emoji,
          len: l.len,
          entities: l.entities,
          waveOn: cyc < l.duty,
          floodFrac: cyc < l.duty ? cyc / l.duty : undefined,
          warnFrac: cyc > 1 - warnSpan ? (cyc - (1 - warnSpan)) / warnSpan : undefined,
          recedeFrac:
            cyc >= l.duty && cyc < l.duty + recedeSpan ? (cyc - l.duty) / recedeSpan : undefined,
        };
      }),
      turtle: {
        row: state.turtle.row,
        x: state.turtle.x,
        invulnerable: state.timeMs < state.turtle.invulnUntilMs,
      },
      birds: state.birds.map((b) => ({
        row: b.row,
        col: b.col,
        width: b.width,
        emoji: b.emoji,
        telegraph: clamp((state.timeMs - b.spawnedAtMs) / (b.strikesAtMs - b.spawnedAtMs), 0, 1),
        struck: b.struck,
      })),
      lives: state.lives,
      timerFrac:
        state.phase === "running"
          ? clamp((state.timerEndsAtMs - state.timeMs) / cfg.timerMs, 0, 1)
          : 1,
      controls: DIRS.map((dir) => ({
        dir,
        names: merged[dir].filter((id) => players.find((p) => p.id === id)?.connected).map(nameOf),
      })),
      sound: state.sound,
      stats: Object.entries(state.stats)
        .map(([id, st]) => ({ name: nameOf(id), hops: st.hops }))
        .sort((a, b) => b.hops - a.hops),
      totalDeaths: state.totalDeaths,
    };
  },

  playerView(state, playerId, players): PlayerViewData {
    const merged = mergedControls(state.controls, players);
    return {
      phase: state.phase,
      dirs: DIRS.filter((d) => merged[d].includes(playerId)),
      level: state.level,
      levelName: LEVELS[state.level].name,
      lives: state.lives,
      locked: state.phase !== "running" || state.timeMs < state.turtle.inputLockUntilMs,
    };
  },
};

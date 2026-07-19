/**
 * Crossy Beach — the shared contract: grid constants, hand-authored level
 * data, and the action/view types that both the server reducer (server.ts)
 * and the React views (HostView/PlayerView) build against.
 *
 * Imported by server.ts, which is bundled into the PartyKit worker: no React,
 * no DOM/browser APIs, and any value imports must stay relative.
 */

export const COLS = 13;
/** Rows per level, bottom to top. Row 0 = start sand, row ROWS-1 = goal. */
export const ROWS = 14;

/** HostView drives the clock: it sends { type: "tick", dtMs } at this rate. */
export const TICK_MS = 125;
/** dt clamp — a backgrounded host tab pauses the game instead of teleporting it. */
export const MAX_DT_MS = 250;
/** Shared per-turtle hop cooldown, so one button-masher can't teleport it. */
export const HOP_COOLDOWN_MS = 120;
/** Per-PLAYER cooldown between presses — curbs spamming without blocking teammates. */
export const PLAYER_COOLDOWN_MS = 300;
export const RESPAWN_INVULN_MS = 1500;
/** Inputs are ignored this long after a respawn so panic taps don't re-kill. */
export const RESPAWN_INPUT_LOCK_MS = 400;
export const LEVEL_INTRO_MS = 2500;
/** A bird's strike visual lingers this long before the bird despawns. */
export const BIRD_LINGER_MS = 400;
/** Wave rows pulse a whole-row warning this long before flooding (cosmetic only). */
export const WAVE_WARNING_MS = 1200;
/** After a flood ends, the water/🌊 fade out over this long (cosmetic only). */
export const WAVE_RECEDE_MS = 400;
export const START_LIVES = 5;

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: Dir[] = ["up", "down", "left", "right"];

// ── level data ──────────────────────────────────────────────────────────────

export type LaneKind = "safe" | "traffic" | "water" | "wave";

export interface LaneTemplate {
  kind: LaneKind;
  /** Entity emoji (traffic/water lanes). */
  emoji?: string;
  dir?: 1 | -1;
  /** Cells per second. */
  speed?: number;
  /** Entities on the lane, spread evenly. */
  count?: number;
  /** Entity length in cells (kelp mats > 1). */
  len?: number;
  /** Wave lanes: seconds per full on+off cycle. */
  period?: number;
  /** Wave lanes: fraction of the period the row is lethal. */
  duty?: number;
  /** Wave lanes: phase offset in seconds. */
  offset?: number;
}

export interface BirdConfig {
  emoji: string;
  /** Average ms between spawns (reducer applies seeded ±30% jitter). */
  intervalMs: number;
  /** The shadow telegraph grows this long before the strike lands. */
  telegraphMs: number;
  /** Cells covered by the strike, centered on the target col. */
  width: number;
}

export interface LevelConfig {
  name: string;
  /** Shown on the level intro banner. */
  tagline: string;
  /** Tide timer; expiry costs a life and the timer resets. */
  timerMs: number;
  /** Exactly ROWS entries, bottom (start) to top (goal). */
  rows: LaneTemplate[];
  birds: BirdConfig | null;
}

const safe = (): LaneTemplate => ({ kind: "safe" });
const traffic = (emoji: string, speed: number, dir: 1 | -1, count: number): LaneTemplate => ({
  kind: "traffic",
  emoji,
  speed,
  dir,
  count,
  len: 1,
});
const water = (
  emoji: string,
  speed: number,
  dir: 1 | -1,
  count: number,
  len: number
): LaneTemplate => ({ kind: "water", emoji, speed, dir, count, len });
const wave = (offset: number): LaneTemplate => ({
  kind: "wave",
  period: 5,
  duty: 0.28,
  offset,
});

export const LEVELS: LevelConfig[] = [
  {
    name: "The Nest",
    tagline: "Out of the sand — watch for crabs!",
    timerMs: 150_000,
    birds: null,
    rows: [
      safe(),
      safe(),
      traffic("🦀", 0.8, 1, 2),
      safe(),
      traffic("🦀", 0.9, -1, 2),
      safe(),
      traffic("🦀", 1.0, 1, 3),
      safe(),
      traffic("🦀", 1.1, -1, 3),
      safe(),
      traffic("🦀", 1.2, 1, 3),
      safe(),
      safe(),
      safe(),
    ],
  },
  {
    name: "The Open Beach",
    tagline: "Gulls overhead — don't stand still!",
    timerMs: 150_000,
    birds: { emoji: "🐦", intervalMs: 9000, telegraphMs: 2000, width: 1 },
    rows: [
      safe(),
      traffic("🦀", 1.2, 1, 3),
      traffic("🏐", 1.8, -1, 2),
      safe(),
      traffic("🦀", 1.3, 1, 3),
      traffic("🏐", 1.9, -1, 2),
      safe(),
      traffic("🦀", 1.4, -1, 3),
      traffic("🏐", 2.0, 1, 2),
      safe(),
      traffic("🦀", 1.5, 1, 3),
      traffic("🏐", 2.1, -1, 2),
      safe(),
      safe(),
    ],
  },
  {
    name: "The Tide Pools",
    tagline: "Ride the kelp — open water sweeps you away!",
    timerMs: 180_000,
    birds: { emoji: "🐦", intervalMs: 10_000, telegraphMs: 2000, width: 1 },
    rows: [
      safe(),
      traffic("🐚", 1.2, 1, 3),
      water("🌿", 0.45, 1, 2, 3),
      water("🌿", 0.55, -1, 3, 3),
      safe(),
      water("🌿", 0.6, 1, 2, 3),
      water("🌿", 0.65, -1, 3, 3),
      safe(),
      traffic("🐚", 1.4, -1, 3),
      water("🌿", 0.7, 1, 3, 3),
      water("🌿", 0.6, -1, 2, 3),
      safe(),
      water("🌿", 0.8, 1, 3, 3),
      safe(),
    ],
  },
  {
    name: "The Surf",
    tagline: "Time the waves… the sea is RIGHT THERE!",
    timerMs: 180_000,
    birds: { emoji: "🪿", intervalMs: 12_000, telegraphMs: 2500, width: 3 },
    rows: [
      safe(),
      wave(0),
      wave(1.3),
      safe(),
      water("🫧", 1.6, 1, 3, 3),
      wave(2.0),
      safe(),
      wave(0.7),
      water("🫧", 1.8, -1, 3, 3),
      wave(2.7),
      safe(),
      wave(1.6),
      wave(3.2),
      safe(),
    ],
  },
];

// ── actions & inputs ────────────────────────────────────────────────────────

export type CrossyBeachHostAction =
  | { type: "tick"; dtMs: number }
  | { type: "play-again" };

export type CrossyBeachInput = { dir: Dir };

// ── view projections ────────────────────────────────────────────────────────

export type SoundKind =
  | "hop"
  | "splat"
  | "splash"
  | "peck"
  | "levelup"
  | "timeout"
  | "win"
  | "gameover";

export type CrossyBeachPhase = "level-intro" | "running" | "won" | "gameover";

export interface HostLaneView {
  kind: LaneKind;
  emoji: string;
  len: number;
  /** Fractional left-edge x of each entity. */
  entities: number[];
  /** Wave lanes: currently lethal? */
  waveOn?: boolean;
  /** Wave lanes: 0..1 progress through the flood, while waveOn. */
  floodFrac?: number;
  /** Wave lanes: 0..1 progress through the pre-flood warning window. */
  warnFrac?: number;
  /** Wave lanes: 0..1 progress through the fade-out right after a flood. */
  recedeFrac?: number;
}

export interface HostBirdView {
  row: number;
  col: number;
  width: number;
  emoji: string;
  /** 0..1 shadow growth; reaches 1 at the moment of the strike. */
  telegraph: number;
  struck: boolean;
}

export interface HostViewData {
  phase: CrossyBeachPhase;
  /** 0-based. */
  level: number;
  levelName: string;
  tagline: string;
  lanes: HostLaneView[];
  turtle: { row: number; x: number; invulnerable: boolean };
  birds: HostBirdView[];
  lives: number;
  /** 1 → 0 as the tide timer drains. */
  timerFrac: number;
  /** Who owns which button — shown on the projector so people yell at the right person. */
  controls: { dir: Dir; names: string[] }[];
  /** Sound trigger: HostView plays `kind` whenever `id` changes. */
  sound: { id: number; kind: SoundKind } | null;
  /** For the won/gameover screens. */
  stats: { name: string; hops: number }[];
  totalDeaths: number;
}

export interface PlayerViewData {
  phase: CrossyBeachPhase;
  /** The direction buttons this phone shows. */
  dirs: Dir[];
  level: number;
  levelName: string;
  lives: number;
  /** True during intro/respawn lock — render buttons disabled. */
  locked: boolean;
}

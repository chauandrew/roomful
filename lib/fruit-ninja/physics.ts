/**
 * Fruit/bomb entities: spawning on a ramping schedule and simple projectile
 * motion. Pure functions, no React/canvas. Coordinates are normalized 0-1
 * (x across width, y down height, matching the hand tracker's space);
 * speeds are per-second in those units, radii are fractions of height.
 */
import type { Entity, EntityKind, SpawnState } from "./types";

export type { Entity, EntityKind, SpawnState } from "./types";

export interface SpawnConfig {
  roundDurationMs: number;
  intervalStartMs: number;
  intervalEndMs: number;
  launchSpeedStart: number;
  launchSpeedEnd: number;
  launchVxMax: number;
  spawnXMargin: number;
  bombProbability: number;
  fruitRadius: number;
  bombRadius: number;
  fruitColors: string[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

export function createSpawnState(): SpawnState {
  return { nextId: 1, nextSpawnAtMs: 600 }; // first launch shortly after "GO"
}

/**
 * Emits every entity whose scheduled launch time has passed. Both the spawn
 * interval and launch speed ramp linearly with the *scheduled* time (not the
 * frame time), so a long frame can't skip part of the ramp.
 */
export function spawnDue(
  state: SpawnState,
  elapsedMs: number,
  cfg: SpawnConfig
): { state: SpawnState; spawned: Entity[] } {
  let { nextId, nextSpawnAtMs } = state;
  const spawned: Entity[] = [];
  while (elapsedMs >= nextSpawnAtMs) {
    const t = nextSpawnAtMs / cfg.roundDurationMs;
    const kind: EntityKind = Math.random() < cfg.bombProbability ? "bomb" : "fruit";
    const radius = kind === "fruit" ? cfg.fruitRadius : cfg.bombRadius;
    const x = cfg.spawnXMargin + Math.random() * (1 - 2 * cfg.spawnXMargin);
    // +-10% per-launch jitter so same-tick launches don't move in lockstep
    const speed = lerp(cfg.launchSpeedStart, cfg.launchSpeedEnd, t) * (0.9 + Math.random() * 0.2);
    spawned.push({
      id: nextId++,
      kind,
      x,
      y: 1 + radius, // just below the bottom edge
      vx: (x < 0.5 ? 1 : -1) * Math.random() * cfg.launchVxMax,
      vy: -speed,
      radius,
      color: cfg.fruitColors[Math.floor(Math.random() * cfg.fruitColors.length)],
    });
    nextSpawnAtMs += lerp(cfg.intervalStartMs, cfg.intervalEndMs, t);
  }
  return { state: { nextId, nextSpawnAtMs }, spawned };
}

/**
 * Advances all entities one frame (semi-implicit Euler) and culls anything
 * that has fallen off the bottom. Culled fruit are returned separately as
 * misses (they cost a life); culled bombs just disappear.
 */
export function updateEntities(
  entities: Entity[],
  dtMs: number,
  gravity: number
): { entities: Entity[]; missedFruit: Entity[] } {
  const dt = dtMs / 1000;
  const kept: Entity[] = [];
  const missedFruit: Entity[] = [];
  for (const e of entities) {
    const vy = e.vy + gravity * dt;
    const moved = { ...e, x: e.x + e.vx * dt, y: e.y + vy * dt, vy };
    if (moved.vy > 0 && moved.y - moved.radius > 1) {
      if (moved.kind === "fruit") missedFruit.push(moved);
    } else {
      kept.push(moved);
    }
  }
  return { entities: kept, missedFruit };
}

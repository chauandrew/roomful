/**
 * Fruit/bomb entities: spawning on a ramping schedule and simple projectile
 * motion. Pure functions, no React/canvas. Coordinates are normalized 0-1
 * (x across width, y down height, matching the hand tracker's space);
 * speeds are per-second in those units, radii are fractions of height.
 */
import { CONFIG } from "./config";

export type EntityKind = "fruit" | "bomb";

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number; // screen-widths/s
  vy: number; // screen-heights/s, positive = down
  radius: number; // fraction of screen height
  color: string; // fruit palette color (bombs draw their own look)
}

export interface SpawnState {
  nextId: number;
  nextSpawnAtMs: number;
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
export function spawnDue(state: SpawnState, elapsedMs: number): { state: SpawnState; spawned: Entity[] } {
  let { nextId, nextSpawnAtMs } = state;
  const spawned: Entity[] = [];
  while (elapsedMs >= nextSpawnAtMs) {
    const t = nextSpawnAtMs / CONFIG.ROUND_DURATION_MS;
    const kind: EntityKind = Math.random() < CONFIG.BOMB_PROBABILITY ? "bomb" : "fruit";
    const radius = kind === "fruit" ? CONFIG.FRUIT_RADIUS : CONFIG.BOMB_RADIUS;
    const x = CONFIG.SPAWN_X_MARGIN + Math.random() * (1 - 2 * CONFIG.SPAWN_X_MARGIN);
    // +-10% per-launch jitter so same-tick launches don't move in lockstep
    const speed = lerp(CONFIG.LAUNCH_SPEED_START, CONFIG.LAUNCH_SPEED_END, t) * (0.9 + Math.random() * 0.2);
    spawned.push({
      id: nextId++,
      kind,
      x,
      y: 1 + radius, // just below the bottom edge
      vx: (x < 0.5 ? 1 : -1) * Math.random() * CONFIG.LAUNCH_VX_MAX,
      vy: -speed,
      radius,
      color: CONFIG.FRUIT_COLORS[Math.floor(Math.random() * CONFIG.FRUIT_COLORS.length)],
    });
    nextSpawnAtMs += lerp(CONFIG.SPAWN_INTERVAL_START_MS, CONFIG.SPAWN_INTERVAL_END_MS, t);
  }
  return { state: { nextId, nextSpawnAtMs }, spawned };
}

/**
 * Advances all entities one frame (semi-implicit Euler) and culls anything
 * that has fallen off the bottom. Culled fruit are returned separately as
 * misses (they cost a life); culled bombs just disappear.
 */
export function updateEntities(entities: Entity[], dtMs: number): { entities: Entity[]; missedFruit: Entity[] } {
  const dt = dtMs / 1000;
  const kept: Entity[] = [];
  const missedFruit: Entity[] = [];
  for (const e of entities) {
    const vy = e.vy + CONFIG.GRAVITY * dt;
    const moved = { ...e, x: e.x + e.vx * dt, y: e.y + vy * dt, vy };
    if (moved.vy > 0 && moved.y - moved.radius > 1) {
      if (moved.kind === "fruit") missedFruit.push(moved);
    } else {
      kept.push(moved);
    }
  }
  return { entities: kept, missedFruit };
}

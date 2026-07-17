/**
 * Shared entity/tracking types for the Fruit Ninja engine. Coordinates are
 * normalized 0-1 (x across width, y down height, un-mirrored MediaPipe
 * space); speeds are per-second in those units, radii are fractions of
 * height.
 */

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

export interface HandDetection {
  x: number;
  y: number;
  handedness?: string;
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  bridged: boolean; // this point followed one or more dropped frames on this slot
}

export interface HandSlot {
  active: boolean;
  trail: TrailPoint[];
  lastSeen: number;
  sawGap: boolean; // slot went unmatched since its last trail point
  handedness?: string;
  vx?: number; // smoothed velocity, normalized units per ms (undefined until 2 points)
  vy?: number;
  player?: 0 | 1; // set only when tuning.midlineDeadzone is provided
}

export interface Splash {
  x: number;
  y: number;
  radius: number; // of the entity that popped, fraction of height
  color: string;
  t: number; // when it was created
}

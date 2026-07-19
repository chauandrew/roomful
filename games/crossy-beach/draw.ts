/**
 * Crossy Beach — pure canvas rendering for the projector board. No React:
 * HostView owns the rAF loop and snapshot bookkeeping and calls drawBoard()
 * once per frame with the previous/current server snapshots to lerp between.
 *
 * Coordinates: the board is COLS x ROWS cells filling the whole canvas,
 * row 0 at the BOTTOM (start sand), row ROWS-1 at the top (the sea).
 */
import { COLS, ROWS } from "./config";
import type { HostViewData, HostLaneView, HostBirdView } from "./config";

export interface BoardFrame {
  curr: HostViewData;
  prev: HostViewData | null;
  /** 0..1 progress from the prev snapshot toward curr (elapsed / TICK_MS). */
  t: number;
  /** performance.now(), for blink/foam/sparkle animation. */
  nowMs: number;
  /** Timestamp of the turtle's last hop, for the scale pulse. */
  hopAtMs: number;
}

const SAND_A = "#f2dfae";
const SAND_B = "#ecd598";
const TRAFFIC_SAND = "#e3c987";
const WATER_BLUE = "#3399cc";
const WET_SAND = "#c2ab77";
const WET_RIPPLE = "#b39a5f";
const FLOOD_BLUE = "#227aa8";
const FOAM = "#eaf6fb";
const WARN_RGB = "239,77,58";
const GOAL_BLUE = "#1878b4";

export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, f: BoardFrame) {
  const cellW = w / COLS;
  const cellH = h / ROWS;
  const { curr, prev } = f;
  // A level change rebuilds every lane from scratch (new kinds/emoji/offsets
  // at the same row indices) — the previous snapshot's lanes describe a
  // different board entirely, so there's nothing valid to lerp from.
  const prevLanes = prev && prev.level === curr.level ? prev.lanes : undefined;

  for (let row = 0; row < ROWS; row++) {
    const y = rowTop(row, h, cellH);
    if (row === ROWS - 1) {
      drawGoalRow(ctx, w, y, cellW, cellH, f.nowMs);
      continue;
    }
    const lane = curr.lanes[row];
    if (!lane) continue;
    drawLaneBackground(ctx, lane, row, y, w, cellH);
    if (lane.kind === "wave") drawWaveLane(ctx, lane, prevLanes?.[row], f.t, y, w, cellW, cellH);
    drawLaneEntities(ctx, lane, prevLanes?.[row], f.t, y, cellW, cellH);
  }

  for (const bird of curr.birds) drawBird(ctx, bird, w, h, cellW, cellH);

  drawTurtle(ctx, curr, h, cellW, cellH, f.nowMs, f.hopAtMs);
}

function rowTop(row: number, h: number, cellH: number): number {
  return h - (row + 1) * cellH;
}

function drawLaneBackground(
  ctx: CanvasRenderingContext2D,
  lane: HostLaneView,
  row: number,
  y: number,
  w: number,
  cellH: number
) {
  switch (lane.kind) {
    case "safe":
      ctx.fillStyle = row % 2 === 0 ? SAND_A : SAND_B;
      break;
    case "traffic":
      ctx.fillStyle = TRAFFIC_SAND;
      break;
    case "water":
      ctx.fillStyle = WATER_BLUE;
      break;
    case "wave":
      // Safe state is exposed WET SAND (clearly standable); the flood paints
      // water over it. Blue backgrounds are reserved for actual water.
      ctx.fillStyle = WET_SAND;
      break;
  }
  ctx.fillRect(0, y, w, cellH);
}

/**
 * Wave row, drawn over its wet-sand background: ripple lines + sheen while
 * safe, two slow whole-row warning pulses before the flood (uniform across the
 * row on purpose — nothing positional to "dodge"), then the flood washes over
 * with a lingering foam crash and fades back out as it recedes.
 */
function drawWaveLane(
  ctx: CanvasRenderingContext2D,
  lane: HostLaneView,
  prevLane: HostLaneView | undefined,
  t: number,
  y: number,
  w: number,
  cellW: number,
  cellH: number
) {
  // Wet-sand detail: two wavy ripple lines and a soft top sheen.
  ctx.strokeStyle = WET_RIPPLE;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  for (let i = 1; i <= 2; i++) {
    const ry = y + cellH * (i / 3);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, ry + Math.sin(x / 22 + i) * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const sheen = ctx.createLinearGradient(0, y, 0, y + cellH);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, y, w, cellH);

  if (lane.waveOn) {
    const k = lerpFrac(prevLane?.floodFrac, lane.floodFrac, t);
    ctx.fillStyle = FLOOD_BLUE;
    ctx.fillRect(0, y, w, cellH);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 3; i++) ctx.fillRect(0, y + cellH * (0.28 + i * 0.24), w, cellH * 0.04);
    // Foam crash on impact, lingering well into the flood.
    if (k < 0.6) {
      ctx.globalAlpha = 1 - k / 0.6;
      ctx.fillStyle = FOAM;
      ctx.fillRect(0, y, w, cellH * 0.55);
      ctx.globalAlpha = 1;
    }
    drawEmoji(ctx, "🌊", 0, y, cellW, cellH, { repeatEvery: 1.5, width: w });
    return;
  }

  if (lane.recedeFrac !== undefined || (prevLane?.kind === "wave" && prevLane.recedeFrac !== undefined)) {
    // The flood just ended: water and 🌊 fade out instead of vanishing.
    const r = lerpFrac(prevLane?.recedeFrac, lane.recedeFrac, t);
    ctx.globalAlpha = 1 - r;
    ctx.fillStyle = FLOOD_BLUE;
    ctx.fillRect(0, y, w, cellH);
    drawEmoji(ctx, "🌊", 0, y, cellW, cellH, { repeatEvery: 1.5, width: w });
    ctx.globalAlpha = 1;
    return;
  }

  if (lane.warnFrac !== undefined) {
    // Two slow swells (~1.7/sec — deliberately gentle, no strobing), with a
    // faint steady floor so the row never hard-blinks.
    const p = lerpFrac(prevLane?.warnFrac, lane.warnFrac, t);
    const pulse = Math.sin(((p * 2) % 1) * Math.PI);
    ctx.fillStyle = `rgba(${WARN_RGB},${0.10 + 0.32 * pulse})`;
    ctx.fillRect(0, y, w, cellH);
  }
}

/** Lerp a 0..1 window-progress field between snapshots; snap when it (re)starts. */
function lerpFrac(prev: number | undefined, curr: number | undefined, t: number): number {
  if (curr === undefined) return prev !== undefined ? 1 : 0;
  if (prev === undefined || prev > curr) return curr;
  return prev + (curr - prev) * t;
}

function drawGoalRow(
  ctx: CanvasRenderingContext2D,
  w: number,
  y: number,
  cellW: number,
  cellH: number,
  nowMs: number
) {
  ctx.fillStyle = GOAL_BLUE;
  ctx.fillRect(0, y, w, cellH);
  drawEmoji(ctx, "🌊", 0, y, cellW, cellH, { repeatEvery: 2, width: w });
  // Twinkling sparkles at fixed pseudo-random spots.
  ctx.font = `${cellH * 0.35}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 5; i++) {
    const phase = Math.sin(nowMs / 400 + i * 2.1);
    if (phase < 0.2) continue;
    ctx.globalAlpha = phase;
    ctx.fillText("✨", ((i * 2.7 + 1.3) % COLS) * cellW, y + cellH * (0.25 + (i % 3) * 0.25));
  }
  ctx.globalAlpha = 1;
}

/** Entities are `len` repeated emoji; x lerps between snapshots, snapping on wrap. */
function drawLaneEntities(
  ctx: CanvasRenderingContext2D,
  lane: HostLaneView,
  prevLane: HostLaneView | undefined,
  t: number,
  y: number,
  cellW: number,
  cellH: number
) {
  if (lane.kind !== "traffic" && lane.kind !== "water") return;
  // Only lerp from a prev entity that's actually the same emoji/kind at this
  // row — otherwise a level swap (e.g. crabs -> volleyballs at the same row
  // index) would visibly slide the new sprite in from the old one's position.
  const samePrev = prevLane?.kind === lane.kind && prevLane.emoji === lane.emoji ? prevLane : undefined;
  for (let e = 0; e < lane.entities.length; e++) {
    const x = lerpWrapped(samePrev?.entities[e], lane.entities[e], t);
    for (let i = 0; i < lane.len; i++) {
      const col = (((x + i) % COLS) + COLS) % COLS;
      drawEmoji(ctx, lane.emoji, col * cellW, y, cellW, cellH);
    }
  }
}

function lerpWrapped(prev: number | undefined, curr: number, t: number): number {
  if (prev === undefined) return curr;
  const dx = curr - prev;
  // A jump of more than half the board means the entity wrapped — snap.
  if (Math.abs(dx) > COLS / 2) return curr;
  return prev + dx * t;
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  bird: HostBirdView,
  w: number,
  h: number,
  cellW: number,
  cellH: number
) {
  const y = rowTop(bird.row, h, cellH);
  const centerX = (bird.col + 0.5) * cellW;
  const halfCells = bird.width / 2;

  if (bird.struck) {
    // Strike landed: draw the bird ON the covered cells.
    for (let i = 0; i < bird.width; i++) {
      const col = bird.col - Math.floor(bird.width / 2) + i;
      if (col < 0 || col >= COLS) continue;
      drawEmoji(ctx, bird.emoji, col * cellW, y, cellW, cellH);
    }
    return;
  }

  // Telegraph: a growing shadow on the target cells, bird descending above.
  const grow = 0.3 + 0.7 * bird.telegraph;
  ctx.fillStyle = `rgba(20,20,30,${0.15 + 0.3 * bird.telegraph})`;
  ctx.beginPath();
  ctx.ellipse(centerX, y + cellH / 2, halfCells * cellW * grow, cellH * 0.3 * grow, 0, 0, Math.PI * 2);
  ctx.fill();

  const rise = (1 - bird.telegraph) * cellH * 2.5;
  ctx.font = `${cellH * 0.85}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(bird.emoji, centerX, Math.max(cellH / 2, y + cellH / 2 - rise));
}

function drawTurtle(
  ctx: CanvasRenderingContext2D,
  view: HostViewData,
  h: number,
  cellW: number,
  cellH: number,
  nowMs: number,
  hopAtMs: number
) {
  const { turtle } = view;
  // ~8Hz blink while invulnerable after a respawn.
  if (turtle.invulnerable && Math.floor(nowMs / 125) % 2 === 1) return;

  // Quick scale pulse right after a hop (positions themselves snap).
  const sinceHop = nowMs - hopAtMs;
  const pulse = sinceHop < 150 ? 1 + 0.25 * (1 - sinceHop / 150) : 1;

  const y = rowTop(turtle.row, h, cellH);
  ctx.font = `${cellH * 0.85 * pulse}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🐢", (turtle.x + 0.5) * cellW, y + cellH / 2);
}

/** Draws an emoji centered in a cell at (x, y); repeatEvery tiles it across `width`. */
function drawEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  tile?: { repeatEvery: number; width: number }
) {
  ctx.font = `${cellH * 0.85}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (tile) {
    for (let cx = cellW / 2; cx < tile.width; cx += cellW * tile.repeatEvery) {
      ctx.fillText(emoji, cx, y + cellH / 2);
    }
  } else {
    ctx.fillText(emoji, x + cellW / 2, y + cellH / 2);
  }
}

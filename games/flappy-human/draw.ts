/**
 * Flappy Human — pure canvas rendering. Sky gradient, ground strip, vector
 * pipes, and the bird as original hand-drawn sprite art (plain PNGs, see
 * public/images/flappy-human/) drawn via ctx.drawImage — swapped between an
 * "up"/"down" flap frame by birdVy, and a dizzy "hit" frame on death.
 *
 * Coordinates: physics.ts works in a fixed logical grid (CONFIG.GAME_W x
 * CONFIG.GAME_H); drawScene scales that grid to the actual canvas pixel
 * size (w, h) at draw time, mirroring how crossy-beach/draw.ts derives
 * cellW/cellH from COLS/ROWS.
 *
 * The camera preview-in-corner is a second small <canvas> that Play.tsx
 * feeds directly via drawMirroredVideoFrame (lib/tracking/drawPose.ts) —
 * that helper already does exactly what's needed, so there's no wrapper
 * for it here.
 */
import { CONFIG } from "./config";
import { clamp } from "./math";
import type { Pipe, GameState } from "./physics";

export interface BirdSprites {
  up: HTMLImageElement;
  down: HTMLImageElement;
  hit: HTMLImageElement;
}

/**
 * Creates the three bird sprite frames. Images start loading immediately
 * (a bare `new Image()` + `.src` assignment); drawBird checks `.complete`
 * each frame and falls back to a plain emoji until each one has loaded, so
 * the bird is never invisible during that brief window. Call once (e.g.
 * from a lazily-initialized ref in Play.tsx) and reuse the same instance.
 */
export function loadBirdSprites(): BirdSprites {
  const up = new Image();
  up.src = CONFIG.BIRD_SPRITE_UP;
  const down = new Image();
  down.src = CONFIG.BIRD_SPRITE_DOWN;
  const hit = new Image();
  hit.src = CONFIG.BIRD_SPRITE_HIT;
  return { up, down, hit };
}

const SKY_TOP = "#5ec8f0";
const SKY_BOTTOM = "#cdeffb";
const GROUND_FILL = "#ded28f";
const GROUND_EDGE = "#b8a968";
const PIPE_FILL = "#4caf50";
const PIPE_EDGE = "#2e7d32";

const GROUND_FRAC = 0.08; // fraction of canvas height reserved for the ground strip

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, state: GameState, sprites: BirdSprites): void {
  const scaleX = w / CONFIG.GAME_W;
  const scaleY = h / CONFIG.GAME_H;
  const groundH = h * GROUND_FRAC;
  const groundY = h - groundH;

  drawSky(ctx, w, h);
  drawPipes(ctx, state.pipes, state.gapHeight, scaleX, scaleY, groundY);
  drawGround(ctx, w, groundY, groundH);
  drawBird(ctx, state.birdY * scaleY, state.birdVy, scaleX, scaleY, state.status, sprites);
  drawScore(ctx, w, state.score);
}

// Cached and rebuilt only when the canvas height changes (e.g. window resize)
// — it depends solely on h, so recreating it every frame would be wasted work.
let cachedSkyGradient: CanvasGradient | null = null;
let cachedSkyGradientH = -1;

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (cachedSkyGradient === null || cachedSkyGradientH !== h) {
    cachedSkyGradient = ctx.createLinearGradient(0, 0, 0, h);
    cachedSkyGradient.addColorStop(0, SKY_TOP);
    cachedSkyGradient.addColorStop(1, SKY_BOTTOM);
    cachedSkyGradientH = h;
  }
  ctx.fillStyle = cachedSkyGradient;
  ctx.fillRect(0, 0, w, h);
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, groundY: number, groundH: number) {
  ctx.fillStyle = GROUND_FILL;
  ctx.fillRect(0, groundY, w, groundH);
  ctx.fillStyle = GROUND_EDGE;
  ctx.fillRect(0, groundY, w, Math.max(2, groundH * 0.12));
}

function drawPipes(
  ctx: CanvasRenderingContext2D,
  pipes: Pipe[],
  gapHeight: number,
  scaleX: number,
  scaleY: number,
  groundY: number
) {
  const pipeW = CONFIG.PIPE_WIDTH * scaleX;
  const capH = CONFIG.PIPE_CAP_HEIGHT * scaleY;
  const capOverhang = pipeW * 0.15;

  for (const pipe of pipes) {
    const x = pipe.x * scaleX;
    // cheap off-canvas cull (left side only; pipes spawn just off the right
    // edge and scroll left, so nothing is ever off-canvas to the right)
    if (x + pipeW < 0) continue;

    const gapY = pipe.gapY * scaleY;
    const gapTop = gapY - (gapHeight * scaleY) / 2;
    const gapBottom = gapY + (gapHeight * scaleY) / 2;

    // Top pipe: from y=0 down to the gap.
    drawPipeRect(ctx, x, 0, pipeW, gapTop, capH, capOverhang, "bottom");
    // Bottom pipe: from the gap down to the ground.
    drawPipeRect(ctx, x, gapBottom, pipeW, groundY - gapBottom, capH, capOverhang, "top");
  }
}

/** Draws one pipe body plus its lip cap nearest the gap ("top" or "bottom" edge of the rect). */
function drawPipeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  capH: number,
  capOverhang: number,
  capEdge: "top" | "bottom"
) {
  if (height <= 0) return;

  ctx.fillStyle = PIPE_FILL;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = PIPE_EDGE;
  ctx.lineWidth = Math.max(1, width * 0.03);
  ctx.strokeRect(x, y, width, height);

  const capY = capEdge === "top" ? y : y + height - capH;
  ctx.fillStyle = PIPE_FILL;
  ctx.fillRect(x - capOverhang, capY, width + capOverhang * 2, capH);
  ctx.strokeRect(x - capOverhang, capY, width + capOverhang * 2, capH);
}

const MIN_TILT_DEG = -30; // pitched up, moving fast upward
const MAX_TILT_DEG = 60; // pitched down, falling fast
const TILT_VY_RANGE = 700; // birdVy magnitude (game units/s) that maps to the full tilt range

function drawBird(
  ctx: CanvasRenderingContext2D,
  birdYPx: number,
  birdVy: number,
  scaleX: number,
  scaleY: number,
  status: GameState["status"],
  sprites: BirdSprites
) {
  const x = CONFIG.BIRD_X * scaleX;
  const radius = CONFIG.BIRD_RADIUS * ((scaleX + scaleY) / 2);

  const t = clamp(birdVy / TILT_VY_RANGE, -1, 1);
  const tiltDeg = t < 0 ? t * -MIN_TILT_DEG : t * MAX_TILT_DEG;

  ctx.save();
  ctx.translate(x, birdYPx);
  ctx.rotate((tiltDeg * Math.PI) / 180);

  const img = status === "dead" ? sprites.hit : birdVy < 0 ? sprites.up : sprites.down;
  if (img.complete && img.naturalWidth > 0) {
    const drawH = radius * 2.6;
    const drawW = drawH * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  } else {
    // Sprite still loading (first frame or two only) — fall back to an emoji
    // so the bird is never invisible.
    ctx.font = `${radius * 2.2}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🐦", 0, 0);
  }
  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, w: number, score: number) {
  const fontSize = Math.round(w * 0.14);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const x = w / 2;
  const y = fontSize * 0.35;

  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = fontSize * 0.08;
  ctx.shadowOffsetY = fontSize * 0.04;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(score), x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

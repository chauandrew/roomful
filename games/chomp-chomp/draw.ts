/**
 * Chomp Chomp's own canvas rendering — the wedge and dot grid. Both are drawn
 * in the same (mirrored) coordinate space as the mirrored video frame, but
 * without needing an extra canvas transform: Play.tsx un-mirrors the
 * face-cursor's x once when it reads the landmark, so everything drawn here
 * uses plain, already-mirrored canvas coordinates.
 */
import type { Dot } from "./logic";
import { CONFIG } from "./config";

export function drawDots(ctx: CanvasRenderingContext2D, dots: Dot[]) {
  ctx.fillStyle = CONFIG.DOT_COLOR;
  for (const dot of dots) {
    if (dot.eaten) continue;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, CONFIG.DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws the Pac-Man wedge centered on `cursor`, facing right, with a mouth
 * gap of `halfAngleRad` on either side of the facing direction.
 */
export function drawWedge(
  ctx: CanvasRenderingContext2D,
  cursor: { x: number; y: number },
  halfAngleRad: number
) {
  const startAngle = halfAngleRad;
  const endAngle = Math.PI * 2 - halfAngleRad;

  ctx.beginPath();
  ctx.moveTo(cursor.x, cursor.y);
  ctx.arc(cursor.x, cursor.y, CONFIG.WEDGE_RADIUS, startAngle, endAngle);
  ctx.closePath();

  ctx.fillStyle = CONFIG.WEDGE_FILL;
  ctx.fill();
  ctx.lineWidth = CONFIG.WEDGE_LINE_WIDTH;
  ctx.strokeStyle = CONFIG.WEDGE_STROKE;
  ctx.stroke();
}

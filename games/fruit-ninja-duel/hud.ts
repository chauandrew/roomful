/**
 * Fruit Ninja Duel's own HUD rendering (per-player scores, timer, center
 * divider) and hand-trail colors — these differ per game, so they live here
 * rather than in the shared lib/fruit-ninja engine.
 */
import type { HandSlot } from "@/lib/fruit-ninja/handTracker";
import { CONFIG } from "./config";

const UNCLAIMED_HAND_COLOR = "#9ca3af"; // neutral gray for a hand not yet attributed to a side

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- index kept to match drawHandTrails' colorForSlot signature; color is keyed off slot.player only
export function colorForSlot(slot: HandSlot, index: number): string {
  if (slot.player === undefined) return UNCLAIMED_HAND_COLOR;
  return CONFIG.PLAYER_COLORS[slot.player];
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scores: [number, number],
  remainingMs: number
): void {
  ctx.lineWidth = 4;
  ctx.strokeStyle = "black";
  ctx.font = `bold ${Math.max(24, canvas.width / 28)}px sans-serif`;

  ctx.fillStyle = CONFIG.PLAYER_COLORS[0];
  const p1Text = `${scores[0]}`;
  ctx.strokeText(p1Text, 24, 72);
  ctx.fillText(p1Text, 24, 72);

  ctx.fillStyle = CONFIG.PLAYER_COLORS[1];
  ctx.textAlign = "right";
  const p2Text = `${scores[1]}`;
  ctx.strokeText(p2Text, canvas.width - 24, 72);
  ctx.fillText(p2Text, canvas.width - 24, 72);
  ctx.textAlign = "left";

  ctx.font = `bold ${Math.max(32, canvas.width / 20)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  const timerText = (remainingMs / 1000).toFixed(1);
  // Larger font than the score text above, so it needs more clearance from
  // the top edge to keep its taller ascent from clipping under a browser's
  // fullscreen safe-area/notch (see the score baseline for the same reasoning).
  ctx.strokeText(timerText, canvas.width / 2, 92);
  ctx.fillText(timerText, canvas.width / 2, 92);
  ctx.textAlign = "left";
}

export function drawDivider(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
}

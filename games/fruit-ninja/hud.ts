/**
 * Fruit Ninja's own HUD rendering (score, lives, timer) and hand-trail
 * colors — these differ per game, so they live here rather than in the
 * shared lib/fruit-ninja engine.
 */
import { CONFIG } from "./config";

export const HAND_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15"];

export function drawHud(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  score: number,
  lives: number,
  remainingMs: number
) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = "black";
  ctx.fillStyle = "white";
  ctx.font = `bold ${Math.max(24, canvas.width / 28)}px sans-serif`;
  const scoreText = `Score ${score}`;
  ctx.strokeText(scoreText, 24, 52);
  ctx.fillText(scoreText, 24, 52);

  ctx.font = `bold ${Math.max(24, canvas.width / 28)}px sans-serif`;
  for (let i = 0; i < CONFIG.LIVES; i++) {
    ctx.fillStyle = i < lives ? "#f87171" : "rgba(255,255,255,0.25)";
    const heartX = 24 + i * Math.max(30, canvas.width / 26);
    ctx.strokeText("♥", heartX, 100);
    ctx.fillText("♥", heartX, 100);
  }

  ctx.font = `bold ${Math.max(32, canvas.width / 20)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  const timerText = (remainingMs / 1000).toFixed(1);
  ctx.strokeText(timerText, canvas.width / 2, 60);
  ctx.fillText(timerText, canvas.width / 2, 60);
  ctx.textAlign = "left";
}

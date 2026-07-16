/**
 * Fruit Ninja engine rendering: entities, slice splashes, and hand trails.
 * Entities and hand trails live in the un-mirrored normalized space the
 * tracker uses; every function here mirrors x once
 * (canvas.width - x * canvas.width) so everything lands in the same mirrored
 * space as the video frame.
 */
import { predictPosition, type HandSlot, type HandTrackerState } from "./handTracker";
import type { Entity, Splash } from "./types";

export type { Splash } from "./types";

export function drawEntities(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, entities: Entity[]) {
  for (const e of entities) {
    const x = canvas.width - e.x * canvas.width;
    const y = e.y * canvas.height;
    const r = e.radius * canvas.height;
    if (e.kind === "fruit") {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.stroke();
    } else {
      // Bomb: dark spiked circle with a fuse spark, readable even in motion.
      ctx.strokeStyle = "#1c1917";
      ctx.lineWidth = Math.max(4, r * 0.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
        ctx.stroke();
      }
      ctx.fillStyle = "#1c1917";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#a8a29e";
      ctx.stroke();
      const fx = x + r * 0.6;
      const fy = y - r * 0.9;
      ctx.strokeStyle = "#a8a29e";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + r * 0.3, y - r * 0.5);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.fillStyle = "#fb923c";
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(4, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Expanding, fading ring + flecks where an entity was just sliced. */
export function drawSplashes(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  splashes: Splash[],
  now: number,
  splashMs: number
) {
  for (const s of splashes) {
    const age = (now - s.t) / splashMs;
    if (age >= 1) continue;
    const x = canvas.width - s.x * canvas.width;
    const y = s.y * canvas.height;
    const r = s.radius * canvas.height;
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 6 * (1 - age);
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + age), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = s.color;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = r * (0.6 + age * 1.2);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Blade trails per hand slot: solid segments are real frame-to-frame motion,
 * dashed marks a segment that bridged dropped detection frames. A slot
 * mid-dropout gets a dashed segment out to its dead-reckoned position and a
 * hollow tip there, so the blade visibly keeps moving instead of freezing.
 */
export function drawHandTrails(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: HandTrackerState,
  now: number,
  colorForSlot: (slot: HandSlot, index: number) => string
) {
  const px = (nx: number) => canvas.width - nx * canvas.width;
  const py = (ny: number) => ny * canvas.height;

  state.forEach((slot, i) => {
    if (!slot.active || slot.trail.length === 0) return;
    const color = colorForSlot(slot, i);

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (let j = 1; j < slot.trail.length; j++) {
      const a = slot.trail[j - 1];
      const b = slot.trail[j];
      ctx.setLineDash(b.bridged ? [12, 12] : []);
      ctx.beginPath();
      ctx.moveTo(px(a.x), py(a.y));
      ctx.lineTo(px(b.x), py(b.y));
      ctx.stroke();
    }

    const last = slot.trail[slot.trail.length - 1];
    const tipRadius = Math.max(8, canvas.width / 80);
    ctx.fillStyle = color;
    if (slot.sawGap) {
      const pred = predictPosition(slot, now);
      if (pred) {
        ctx.setLineDash([12, 12]);
        ctx.beginPath();
        ctx.moveTo(px(last.x), py(last.y));
        ctx.lineTo(px(pred.x), py(pred.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px(pred.x), py(pred.y), tipRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px(last.x), py(last.y), tipRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([]);
  });
}

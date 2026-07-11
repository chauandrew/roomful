import { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./types";

/**
 * Draw the video frame mirrored onto the canvas, so it reads like a mirror.
 * Landmarks share the same transform when drawn afterward, so a skeleton
 * overlay stays aligned with the flipped video.
 */
export function drawMirroredVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/**
 * Draw a pose skeleton overlay, mirrored the same way drawMirroredVideoFrame
 * mirrors the video, so the two stay aligned regardless of call order. Each
 * draw call manages its own transform (save/restore internally) rather than
 * relying on the caller to share one across both calls.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  color = "rgba(80, 220, 255, 0.85)"
) {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);

  ctx.lineWidth = Math.max(2, canvas.width / 320);
  ctx.strokeStyle = color;
  for (const c of PoseLandmarker.POSE_CONNECTIONS) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  const r = Math.max(2, canvas.width / 360);
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

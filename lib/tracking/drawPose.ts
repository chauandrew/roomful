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
// BlazePose landmarks 0-10 are all face points (nose, eyes, ears, mouth) —
// skipped so the overlay reads as a body skeleton, not a face mask.
const MIN_BODY_LANDMARK = 11;

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
    if (c.start < MIN_BODY_LANDMARK || c.end < MIN_BODY_LANDMARK) continue;
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
  for (let i = MIN_BODY_LANDMARK; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * A dashed vertical line down the exact horizontal center of the canvas —
 * for two-player games that need to show players which half of the frame is
 * theirs. Symmetric around the midpoint, so it needs no mirror transform.
 */
export function drawCenterLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, color = "rgba(255, 255, 255, 0.35)") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, canvas.width / 480);
  ctx.setLineDash([canvas.height / 40, canvas.height / 60]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
  ctx.restore();
}

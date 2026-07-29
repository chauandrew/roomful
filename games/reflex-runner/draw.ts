/**
 * Reflex Runner — pure canvas rendering. Sky-to-ground background, a road
 * rendered in pseudo-3D perspective (converging to a vanishing point so
 * jumps/ducks read as depth, not a flat top-down lane swap), and the runner
 * plus obstacles drawn with vector primitives — no sprite art.
 *
 * Coordinates: physics.ts works in a fixed logical grid (CONFIG.GAME_W x
 * CONFIG.GAME_H); drawScene scales that grid to the actual canvas pixel size
 * (w, h) at draw time, mirroring flappy-human/draw.ts.
 *
 * Perspective: linear interpolation from the vanishing point to the near
 * plane, deliberately NOT a true inverse-distance (1/z) projection — a real
 * camera's perspective divide accelerates sharply as z -> 0, which reads as
 * obstacles suddenly lurching at the player right before contact. Since
 * world-space speed (obstacle.z, in physics.ts) is already constant, a
 * linear projection keeps the on-screen approach speed constant too, all
 * the way in — no ramp-up, no last-instant spike. For a depth z (CONFIG.FAR_Z
 * at spawn, 0 at the player):
 *   t = clamp(z / FAR_Z, 0, 1)              — 0 at player, 1 at vanishing point
 *   scale(t) = lerp(1, MIN_SCALE, t)        — shrink factor for widths/heights
 *   screenX = lerp(xNear, VANISH_X, t)      — lane x position converges
 *   screenY = lerp(NEAR_Y, VANISH_Y, t)     — ground line converges
 */
import { CONFIG } from "./config";
import { clamp, lerp } from "./math";
import type { GameState, Obstacle } from "./physics";

// --- Palette (synthwave: near-black backdrop, glowing neon accents) ---
const SKY_TOP = "#0d0221";
const SKY_BOTTOM = "#1a0836";
const ROAD_FILL = "#0a0a16";
const LANE_LINE = "#00fff2";
const RUNNER_FILL = "#ffffff";
const RUNNER_OUTLINE = "#00fff2";
const HIT_FILL = "#ff003c"; // runner flips to this the instant a collision happens, so contact reads unmistakably
const HIT_OUTLINE = "#80001e";
const HIT_HALO = "rgba(255, 0, 60, 0.35)";
const DUCK_FILL = "#faff00"; // neon yellow bar, sits high — "go under"
const DUCK_EDGE = "#c9cc00";
const JUMP_FILL = "#ff2079"; // neon pink block, sits low on the ground — "go over"
const JUMP_EDGE = "#b3004f";
const LANE_FILL = "#b026ff"; // neon purple pillar, one lane wide — "get out of this lane"
const LANE_EDGE = "#6f0fb3";
const GLOW_BLUR_NEAR = 8; // glow radius in logical px at the near plane, scaled like other sizes in this file

// --- Perspective constants (feel decisions, not physics — local to rendering) ---
const VANISH_X = CONFIG.GAME_W / 2; // horizontal center
const VANISH_Y = CONFIG.GAME_H * 0.35; // upper third
const NEAR_Y = CONFIG.GAME_H * 0.94; // ground line at the player's depth
const MIN_SCALE = 0.08; // shrink factor at the vanishing point (never fully 0, stays visible)
const LANE_WIDTH_NEAR = CONFIG.GAME_W * 0.24; // width of one lane at the near (player) plane
const ROAD_HALF_WIDTH_NEAR = LANE_WIDTH_NEAR * 1.5; // 3 lanes wide, centered on VANISH_X

// Obstacle heights/thicknesses at the near plane, in logical units, scaled by scale(t).
const JUMP_HEIGHT_NEAR = 70; // hurdle height off the ground
const DUCK_BAR_Y_NEAR = 150; // duck bar's height above the ground
const DUCK_BAR_THICKNESS_NEAR = 34;
const LANE_PILLAR_HEIGHT_NEAR = 220;
const LANE_BARRIER_WIDTH_FRAC = 0.72; // fraction of a lane's width, leaves a visible gap to neighboring lanes

// Runner body, in logical units.
const RUNNER_BODY_W = 46;
const RUNNER_BODY_H = 74;
const RUNNER_DUCK_SCALE_Y = 0.55;
const RUNNER_DUCK_SCALE_X = 1.3;
const LEG_LENGTH = 26;
const LEG_SWING_PERIOD_MS = 90; // period of the running-leg scissor animation
const LEG_SWING_ANGLE = 0.9; // radians, max leg swing from vertical

function depthT(z: number): number {
  return clamp(z / CONFIG.FAR_Z, 0, 1);
}

function depthScale(t: number): number {
  return lerp(1, MIN_SCALE, t);
}

/**
 * x position of a lane (0..2, continuous) at the near plane, lane 1 = center.
 * Mirrored (1 - laneX, not laneX - 1): the detector's lane signal comes from
 * MediaPipe's raw, unmirrored camera frame, where a player's physical-right
 * lean reads as a DEcrease in raw shoulder x (same as an ordinary
 * un-mirrored photo of someone facing the camera) and so maps to a LOWER
 * lane number. Mirroring here — the one place lane numbers become screen
 * pixels — makes the runner move the same direction the player sees
 * themselves move in the mirrored camera-preview PIP, instead of backwards.
 */
function laneXNear(laneX: number): number {
  return VANISH_X + (1 - laneX) * LANE_WIDTH_NEAR;
}

function projectX(xNear: number, t: number): number {
  return lerp(xNear, VANISH_X, t);
}

function projectY(t: number): number {
  return lerp(NEAR_Y, VANISH_Y, t);
}

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, state: GameState): void {
  const scaleX = w / CONFIG.GAME_W;
  const scaleY = h / CONFIG.GAME_H;

  drawBackground(ctx, w, h);
  drawRoad(ctx, scaleX, scaleY);

  const sortedObstacles = [...state.obstacles].sort((a, b) => b.z - a.z); // far to near, painter's algorithm
  for (const obstacle of sortedObstacles) {
    drawObstacle(ctx, obstacle, scaleX, scaleY);
  }

  drawRunner(ctx, state, scaleX, scaleY);
  drawScore(ctx, w, state.score);
}

// Cached and rebuilt only when the canvas height changes, same pattern as
// flappy-human's cachedSkyGradient — it depends solely on h.
let cachedSkyGradient: CanvasGradient | null = null;
let cachedSkyGradientH = -1;

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (cachedSkyGradient === null || cachedSkyGradientH !== h) {
    cachedSkyGradient = ctx.createLinearGradient(0, 0, 0, h);
    cachedSkyGradient.addColorStop(0, SKY_TOP);
    cachedSkyGradient.addColorStop(1, SKY_BOTTOM);
    cachedSkyGradientH = h;
  }
  ctx.fillStyle = cachedSkyGradient;
  ctx.fillRect(0, 0, w, h);
}

function drawRoad(ctx: CanvasRenderingContext2D, scaleX: number, scaleY: number) {
  const leftNear = VANISH_X - ROAD_HALF_WIDTH_NEAR;
  const rightNear = VANISH_X + ROAD_HALF_WIDTH_NEAR;

  ctx.fillStyle = ROAD_FILL;
  ctx.beginPath();
  ctx.moveTo(leftNear * scaleX, NEAR_Y * scaleY);
  ctx.lineTo(rightNear * scaleX, NEAR_Y * scaleY);
  ctx.lineTo(VANISH_X * scaleX, VANISH_Y * scaleY);
  ctx.closePath();
  ctx.fill();

  // Two interior lane dividers (between lane 0/1 and lane 1/2), converging to the vanishing point.
  ctx.strokeStyle = LANE_LINE;
  ctx.lineWidth = Math.max(1, scaleX * 2);
  ctx.shadowColor = LANE_LINE;
  ctx.shadowBlur = GLOW_BLUR_NEAR * scaleX;
  for (const laneBoundary of [0.5, 1.5]) {
    const xNear = laneXNear(laneBoundary);
    ctx.beginPath();
    ctx.moveTo(xNear * scaleX, NEAR_Y * scaleY);
    ctx.lineTo(VANISH_X * scaleX, VANISH_Y * scaleY);
    ctx.stroke();
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: Obstacle, scaleX: number, scaleY: number) {
  const { z, type } = obstacle;
  if (z > CONFIG.FAR_Z || z < -CONFIG.OBSTACLE_THICKNESS) return; // cheap cull

  const t = depthT(z);
  const scale = depthScale(t);
  const groundY = projectY(t);

  if (type === "jump") {
    const width = ROAD_HALF_WIDTH_NEAR * 2 * scale;
    const height = JUMP_HEIGHT_NEAR * scale;
    const x = VANISH_X * scaleX - (width * scaleX) / 2;
    const y = (groundY - JUMP_HEIGHT_NEAR * scale) * scaleY;
    fillRectWithEdge(ctx, x, y, width * scaleX, height * scaleY, JUMP_FILL, JUMP_EDGE, scaleX);
    return;
  }

  if (type === "duck") {
    const width = ROAD_HALF_WIDTH_NEAR * 2 * scale;
    const thickness = DUCK_BAR_THICKNESS_NEAR * scale;
    const barY = groundY - DUCK_BAR_Y_NEAR * scale;
    const x = VANISH_X * scaleX - (width * scaleX) / 2;
    const y = barY * scaleY;
    fillRectWithEdge(ctx, x, y, width * scaleX, thickness * scaleY, DUCK_FILL, DUCK_EDGE, scaleX);
    return;
  }

  // "lane": tall pillar in a single lane's width
  const width = LANE_WIDTH_NEAR * LANE_BARRIER_WIDTH_FRAC * scale;
  const height = LANE_PILLAR_HEIGHT_NEAR * scale;
  const centerX = projectX(laneXNear(obstacle.lane), t);
  const x = (centerX - width / 2) * scaleX;
  const y = (groundY - height) * scaleY;
  fillRectWithEdge(ctx, x, y, width * scaleX, height * scaleY, LANE_FILL, LANE_EDGE, scaleX);
}

function fillRectWithEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  edge: string,
  scaleX: number
) {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, width * 0.04);
  ctx.shadowColor = edge;
  ctx.shadowBlur = GLOW_BLUR_NEAR * scaleX;
  ctx.strokeRect(x, y, width, height);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function drawRunner(ctx: CanvasRenderingContext2D, state: GameState, scaleX: number, scaleY: number) {
  const xNear = laneXNear(state.laneX);

  const airborneRatio = clamp(state.airborneMs / CONFIG.JUMP_DURATION_MS, 0, 1);
  const heightRatio = state.airborneMs > 0 ? Math.sin(Math.PI * (1 - airborneRatio)) : 0;
  const jumpOffsetPx = heightRatio * CONFIG.JUMP_HEIGHT * scaleY;

  const bodyW = (state.ducking ? RUNNER_BODY_W * RUNNER_DUCK_SCALE_X : RUNNER_BODY_W) * scaleX;
  const bodyH = (state.ducking ? RUNNER_BODY_H * RUNNER_DUCK_SCALE_Y : RUNNER_BODY_H) * scaleY;

  const feetX = xNear * scaleX;
  const feetY = NEAR_Y * scaleY - jumpOffsetPx;
  const bodyBottomY = feetY - LEG_LENGTH * scaleY;
  const bodyTopY = bodyBottomY - bodyH;

  // Legs scissor while running; hold still mid-air/mid-duck (no ground contact to animate against).
  const legSwing = state.airborneMs > 0 || state.ducking ? 0 : Math.sin(state.elapsedMs / LEG_SWING_PERIOD_MS) * LEG_SWING_ANGLE;
  const legLenPx = LEG_LENGTH * scaleY;
  ctx.strokeStyle = RUNNER_OUTLINE;
  ctx.lineWidth = Math.max(2, scaleX * 4);
  ctx.lineCap = "round";
  ctx.shadowColor = RUNNER_OUTLINE;
  ctx.shadowBlur = GLOW_BLUR_NEAR * scaleX;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(feetX, bodyBottomY);
    ctx.lineTo(feetX + Math.sin(legSwing * sign) * legLenPx * 0.6, feetY);
    ctx.stroke();
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  const isDead = state.status === "dead";

  // Impact halo, drawn behind the body so the moment of contact reads at a
  // glance — this frame is what stays frozen on screen as the RESULTS
  // backdrop, so it needs to land in a single still frame, not an animation.
  if (isDead) {
    const bodyCenterY = (bodyTopY + bodyBottomY) / 2;
    ctx.fillStyle = HIT_HALO;
    ctx.beginPath();
    ctx.arc(feetX, bodyCenterY, bodyW * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const outlineColor = isDead ? HIT_OUTLINE : RUNNER_OUTLINE;
  ctx.fillStyle = isDead ? HIT_FILL : RUNNER_FILL;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = isDead ? Math.max(2, scaleX * 5) : Math.max(1, scaleX * 3);
  ctx.beginPath();
  ctx.roundRect(feetX - bodyW / 2, bodyTopY, bodyW, bodyBottomY - bodyTopY, bodyW * 0.35);
  ctx.fill();
  ctx.shadowColor = outlineColor;
  ctx.shadowBlur = GLOW_BLUR_NEAR * scaleX;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

/**
 * Raw-frame (0..1, unmirrored MediaPipe space) x positions of the two lane
 * boundaries, at the exact CONFIG.LANE_ENTER_THRESHOLD detector.ts uses to
 * decide a lane switch — so a guide line drawn at these positions marks the
 * literal moment a lean crosses into a side lane, not an approximation.
 */
export function laneGuideXPositions(baseline: { x: number; width: number }): [number, number] {
  return [
    baseline.x - CONFIG.LANE_ENTER_THRESHOLD * baseline.width,
    baseline.x + CONFIG.LANE_ENTER_THRESHOLD * baseline.width,
  ];
}

/**
 * Draws the two lane-boundary guide lines on the camera PIP, mirrored the
 * same way drawMirroredVideoFrame/drawSkeleton mirror the video (see
 * lib/tracking/drawPose.ts), so they align with the video feed underneath.
 * Semi-transparent so the player's video feed stays visible under the lines.
 */
export function drawLaneGuides(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, baseline: { x: number; width: number }) {
  const [xLeft, xRight] = laneGuideXPositions(baseline);
  const scaleX = canvas.width / 320; // same PIP-canvas scale reference drawSkeleton uses (lib/tracking/drawPose.ts)

  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);

  ctx.strokeStyle = LANE_LINE;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(2, scaleX);
  ctx.shadowColor = LANE_LINE;
  ctx.shadowBlur = GLOW_BLUR_NEAR * scaleX;
  for (const x of [xLeft, xRight]) {
    ctx.beginPath();
    ctx.moveTo(x * canvas.width, 0);
    ctx.lineTo(x * canvas.width, canvas.height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, w: number, score: number) {
  const fontSize = Math.round(w * 0.14);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const x = w / 2;
  const y = fontSize * 0.35;

  // Dark drop-shadow first, for legibility against the near-black sky (a plain glow alone
  // doesn't separate the cyan text from a dark background the way it separated white before).
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = fontSize * 0.08;
  ctx.shadowOffsetY = fontSize * 0.04;
  ctx.fillStyle = LANE_LINE;
  ctx.fillText(String(score), x, y);
  ctx.shadowOffsetY = 0;

  // Neon glow pass on top.
  ctx.shadowColor = LANE_LINE;
  ctx.shadowBlur = fontSize * 0.18;
  ctx.fillText(String(score), x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

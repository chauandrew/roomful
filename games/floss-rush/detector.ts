/**
 * Floss detection.
 *
 * Primary signal: arms and hips swing in OPPOSITE horizontal directions.
 * Secondary soft signal: hands alternate front/behind the torso (depth z).
 * A swing is one direction-reversal of the arm signal past an amplitude
 * threshold, but only counts when arm/hip opposition held during it.
 */
import { MovingAverage, isVisible } from "@/lib/tracking/signals";
import type { Landmark } from "@/lib/tracking/types";
import { CONFIG } from "./config";

// BlazePose (MediaPipe Pose) landmark indices we rely on.
const IDX = {
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
};
const REQUIRED = [IDX.L_SHOULDER, IDX.R_SHOULDER, IDX.L_WRIST, IDX.R_WRIST, IDX.L_HIP, IDX.R_HIP];

/**
 * The single visibility rule shared by in-game counting and the camera-check
 * page, so "ready" on the check screen can never disagree with the game.
 */
export function isBodyVisible(landmarks: Landmark[] | undefined | null): boolean {
  return isVisible(landmarks, REQUIRED, CONFIG.VISIBILITY_THRESHOLD);
}

export interface SwingEvent {
  points: number;
  width: number;
  goodForm: boolean;
}

export interface DetectorResult {
  detected: boolean;
  visible: boolean;
  swing: SwingEvent | null;
}

export class FlossDetector {
  private armMA!: MovingAverage;
  private hipMA!: MovingAverage;
  private lzMA!: MovingAverage;
  private rzMA!: MovingAverage;

  private prevArm: number | null = null;
  private prevHip: number | null = null;
  private armDirection = 0; // 1 / -1 / 0
  private lastReversalArm = 0; // arm extreme at the previous reversal (baseline for width)
  private swingExtreme = 0; // farthest arm value reached during the current swing

  private oppAccum = 0; // running sum of sign(armVel)*sign(hipVel) since last reversal
  private oppFrames = 0;

  private lastZSign = 0; // sign(leftWristZ - rightWristZ) at the previous counted swing

  constructor() {
    this.reset();
  }

  reset() {
    this.armMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);
    this.hipMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);
    this.lzMA = new MovingAverage(CONFIG.DEPTH_SMOOTHING_WINDOW);
    this.rzMA = new MovingAverage(CONFIG.DEPTH_SMOOTHING_WINDOW);

    this.prevArm = null;
    this.prevHip = null;
    this.armDirection = 0;
    this.lastReversalArm = 0;
    this.swingExtreme = 0;

    this.oppAccum = 0;
    this.oppFrames = 0;

    this.lastZSign = 0;
  }

  update(landmarks: Landmark[] | undefined | null): DetectorResult {
    if (!landmarks) return { detected: false, visible: false, swing: null };

    const visible = isBodyVisible(landmarks);
    if (!visible) return { detected: true, visible: false, swing: null };

    const lSh = landmarks[IDX.L_SHOULDER];
    const rSh = landmarks[IDX.R_SHOULDER];
    const lWr = landmarks[IDX.L_WRIST];
    const rWr = landmarks[IDX.R_WRIST];
    const lHip = landmarks[IDX.L_HIP];
    const rHip = landmarks[IDX.R_HIP];

    const shoulderCenterX = (lSh.x + rSh.x) / 2;
    const shoulderWidth = Math.max(Math.abs(lSh.x - rSh.x), CONFIG.MIN_SHOULDER_WIDTH);

    // Horizontal signals, relative to the shoulder center and scaled by shoulder width.
    // Using the shoulder center as the reference frame cancels out camera translation, and
    // because the floss swings arms one way while hips go the other, these move in opposition.
    const rawArm = ((lWr.x + rWr.x) / 2 - shoulderCenterX) / shoulderWidth;
    const rawHip = ((lHip.x + rHip.x) / 2 - shoulderCenterX) / shoulderWidth;

    const arm = this.armMA.push(rawArm);
    const hip = this.hipMA.push(rawHip);
    const lz = this.lzMA.push(lWr.z);
    const rz = this.rzMA.push(rWr.z);

    // First valid frame: seed state, nothing to compare against yet.
    if (this.prevArm === null) {
      this.prevArm = arm;
      this.prevHip = hip;
      this.lastReversalArm = arm;
      this.swingExtreme = arm;
      return { detected: true, visible: true, swing: null };
    }

    const armVel = arm - this.prevArm;
    const hipVel = hip - (this.prevHip ?? hip);

    // Track the farthest point of the current swing. Width is measured between
    // extremes rather than at reversal-confirmation time — confirming a flip takes
    // a couple of frames, and by then the smoothed signal has already pulled back
    // from the true turning point (under-measuring fast swings the most).
    if (this.armDirection > 0) this.swingExtreme = Math.max(this.swingExtreme, arm);
    else if (this.armDirection < 0) this.swingExtreme = Math.min(this.swingExtreme, arm);
    else this.swingExtreme = arm;

    // Track arm direction with a deadzone so jitter doesn't flip the sign.
    let newArmDir = this.armDirection;
    if (Math.abs(armVel) > CONFIG.VELOCITY_DEADZONE) newArmDir = Math.sign(armVel);

    // Accumulate opposition: -1 when arm/hip move opposite (good), +1 when same direction.
    if (Math.abs(armVel) > CONFIG.VELOCITY_DEADZONE && Math.abs(hipVel) > CONFIG.VELOCITY_DEADZONE) {
      this.oppAccum += Math.sign(armVel) * Math.sign(hipVel);
      this.oppFrames += 1;
    }

    let swing: SwingEvent | null = null;

    // A reversal = arm direction flipped from the established direction.
    if (newArmDir !== 0 && this.armDirection !== 0 && newArmDir !== this.armDirection) {
      const width = Math.abs(this.swingExtreme - this.lastReversalArm);

      if (width >= CONFIG.AMPLITUDE_THRESHOLD) {
        // Genuine reversal. Did the arms and hips oppose each other during this swing?
        const oppScore = this.oppFrames > 0 ? this.oppAccum / this.oppFrames : 0;
        const oppositionHeld = oppScore <= -CONFIG.OPPOSITION_TOLERANCE;

        if (oppositionHeld) {
          let points = CONFIG.BASE_POINTS + Math.round((width - CONFIG.MIN_WIDTH) / CONFIG.WIDTH_STEP);
          points = Math.max(CONFIG.BASE_POINTS, Math.min(CONFIG.MAX_POINTS_PER_SWING, points));

          // Secondary soft signal: did the front/behind hand flip? Only a confidence booster —
          // never gates the count, and is skipped when depth separation is too small to trust.
          let goodForm = false;
          const zDiff = lz - rz;
          if (Math.abs(zDiff) > CONFIG.DEPTH_SEPARATION_THRESHOLD) {
            const zSign = Math.sign(zDiff);
            if (this.lastZSign !== 0 && zSign !== this.lastZSign) goodForm = true;
            this.lastZSign = zSign;
          }

          swing = { points, width, goodForm };
        }
      }

      // Re-baseline on EVERY confirmed reversal, counted or not. The velocity deadzone
      // already filters jitter, so an unconfirmed-to-count reversal is still real motion —
      // keeping the old baseline would measure later swings from a stale mid-point
      // (half their true width) and silently drop fast, narrower swings.
      this.lastReversalArm = this.swingExtreme;
      this.swingExtreme = arm;
      this.oppAccum = 0;
      this.oppFrames = 0;
    }

    this.armDirection = newArmDir;
    this.prevArm = arm;
    this.prevHip = hip;

    return { detected: true, visible: true, swing };
  }
}

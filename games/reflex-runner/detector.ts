/**
 * Reflex Runner pose detection: lean left/right (lane), crouch (duck), and a
 * fast rise (jump), all measured from shoulder-center position relative to a
 * baseline captured once by calibrate(), normalized by shoulder width so
 * detection works regardless of player height/distance from camera. Same
 * MovingAverage smoothing + real-elapsed-time (dtMs) discipline as
 * flappy-human's FlapDetector — see games/flappy-human/detector.ts.
 *
 * Lane and duck are positional with hysteresis (narrower exit than entry
 * band) rather than events: the player simply IS in whichever lane/duck
 * state their current position falls in. A real jump's crouch windup will
 * briefly cross DUCK_ENTER too — that's expected, reported honestly, and
 * physics.ts's problem to not penalize.
 *
 * Jump is the one transient event: a fast rise past baseline confirmed for
 * JUMP_CONFIRM_MS (rejects jitter), fires once, then a cooldown blocks a
 * re-fire off the same physical jump.
 */
import { MovingAverage, isVisible } from "@/lib/tracking/signals";
import type { Landmark } from "@/lib/tracking/types";
import { CONFIG } from "./config";

// BlazePose (MediaPipe Pose) landmark indices we rely on.
export const IDX = {
  L_SHOULDER: 11,
  R_SHOULDER: 12,
};
const REQUIRED = [IDX.L_SHOULDER, IDX.R_SHOULDER];

/**
 * The single visibility rule shared by in-game detection and the camera-check
 * page, so "ready" on the check screen can never disagree with the game.
 */
export function isBodyVisible(landmarks: Landmark[] | undefined | null): boolean {
  return isVisible(landmarks, REQUIRED, CONFIG.VISIBILITY_THRESHOLD);
}

export interface DetectorResult {
  visible: boolean;
  lane: 0 | 1 | 2; // 0 = left, 1 = center, 2 = right
  ducking: boolean;
  jumped: boolean; // true for exactly the one update() call where a jump is confirmed
}

/**
 * Tracks how long a boolean condition has held continuously — resets to 0
 * the instant it breaks. Same pattern as FlapDetector's private HoldTimer.
 */
class HoldTimer {
  private ms = 0;

  /** Advances by dtMs if `held`, otherwise resets to 0. Returns the new total. */
  tick(held: boolean, dtMs: number): number {
    this.ms = held ? this.ms + dtMs : 0;
    return this.ms;
  }

  reset() {
    this.ms = 0;
  }
}

export class RunnerDetector {
  private leanXMA!: MovingAverage;
  private duckYMA!: MovingAverage;

  private baselineX: number | null = null;
  private baselineY: number | null = null;
  private baselineWidth: number = CONFIG.MIN_SHOULDER_WIDTH;

  private lane: 0 | 1 | 2 = 1;
  private ducking = false;

  private jumpRiseHold = new HoldTimer();
  private jumpCooldownMs = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.leanXMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);
    this.duckYMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);

    this.baselineX = null;
    this.baselineY = null;
    this.baselineWidth = CONFIG.MIN_SHOULDER_WIDTH;

    this.lane = 1;
    this.ducking = false;

    this.jumpRiseHold.reset();
    this.jumpCooldownMs = 0;
  }

  /**
   * Captures the neutral baseline. Call once, when the player is confirmed
   * ready. Returns the calibrated {x, width} on success (so callers like the
   * lane-guide overlay can draw against the exact same baseline), or null on
   * any early-return path.
   */
  calibrate(landmarks: Landmark[] | undefined | null): { x: number; width: number } | null {
    if (!landmarks) return null;
    const lSh = landmarks[IDX.L_SHOULDER];
    const rSh = landmarks[IDX.R_SHOULDER];
    if (!lSh || !rSh) return null;

    this.baselineX = (lSh.x + rSh.x) / 2;
    this.baselineY = (lSh.y + rSh.y) / 2;
    this.baselineWidth = Math.max(Math.abs(lSh.x - rSh.x), CONFIG.MIN_SHOULDER_WIDTH);
    return { x: this.baselineX, width: this.baselineWidth };
  }

  /** `dtMs` is the real elapsed time since the previous call, so timing is frame-rate independent. */
  update(landmarks: Landmark[] | undefined | null, dtMs: number): DetectorResult {
    if (!landmarks) return { visible: false, lane: this.lane, ducking: this.ducking, jumped: false };

    const visible = isBodyVisible(landmarks);
    if (!visible) return { visible: false, lane: this.lane, ducking: this.ducking, jumped: false };

    if (this.baselineX === null || this.baselineY === null) {
      // Not calibrated yet (e.g. still on the camera-check/countdown screen).
      return { visible: true, lane: 1, ducking: false, jumped: false };
    }

    const lSh = landmarks[IDX.L_SHOULDER];
    const rSh = landmarks[IDX.R_SHOULDER];
    const shoulderCenterX = (lSh.x + rSh.x) / 2;
    const shoulderCenterY = (lSh.y + rSh.y) / 2;

    const rawLeanX = (shoulderCenterX - this.baselineX) / this.baselineWidth;
    const rawDuckY = (shoulderCenterY - this.baselineY) / this.baselineWidth;

    const leanX = this.leanXMA.push(rawLeanX);
    const duckY = this.duckYMA.push(rawDuckY);

    // Lane: positional hysteresis, narrower exit band than entry band.
    if (this.lane === 1) {
      if (leanX > CONFIG.LANE_ENTER_THRESHOLD) this.lane = 2;
      else if (leanX < -CONFIG.LANE_ENTER_THRESHOLD) this.lane = 0;
    } else if (this.lane === 0) {
      if (leanX > -CONFIG.LANE_EXIT_THRESHOLD) this.lane = 1;
    } else {
      if (leanX < CONFIG.LANE_EXIT_THRESHOLD) this.lane = 1;
    }

    // Duck: positional hysteresis on the same vertical signal jump uses.
    if (!this.ducking) {
      if (duckY > CONFIG.DUCK_ENTER_THRESHOLD) this.ducking = true;
    } else {
      if (duckY < CONFIG.DUCK_EXIT_THRESHOLD) this.ducking = false;
    }

    // Jump: confirm-hold -> fire once -> cooldown -> idle.
    let jumped = false;
    if (this.jumpCooldownMs > 0) {
      this.jumpCooldownMs -= dtMs;
    } else {
      const risen = duckY < CONFIG.JUMP_RISE_THRESHOLD;
      const held = this.jumpRiseHold.tick(risen, dtMs);
      if (held >= CONFIG.JUMP_CONFIRM_MS) {
        jumped = true;
        this.jumpCooldownMs = CONFIG.JUMP_COOLDOWN_MS;
        this.jumpRiseHold.reset();
      }
    }

    return { visible: true, lane: this.lane, ducking: this.ducking, jumped };
  }
}

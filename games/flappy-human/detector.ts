/**
 * Flap detection.
 *
 * Signal: vertical wrist position relative to shoulder height, normalized by
 * shoulder width. MediaPipe's y grows DOWNWARD, so a downward arm swing is a
 * positive-velocity signal. The combined "arm" signal is just the average of
 * the two wrists — computed inline from `l`/`r` rather than tracked as its
 * own smoothed signal, since (mean of two moving averages) is always exactly
 * equal to (moving average of the mean) when both use the same window.
 *
 * A flap is detected directly from a downward swing — no "must raise first"
 * requirement — so repeated fast flapping doesn't need a full reset to a
 * raised position between reps. The detector cycles through four phases:
 *
 *   idle -> pendingStart -> swinging -> cooldown -> idle -> ...
 *
 *   - idle: waiting for downward velocity to clear FLAP_START_VELOCITY.
 *   - pendingStart: velocity is above threshold, but not yet confirmed —
 *     held here for FLAP_START_CONFIRM_MS. Pose landmarks jitter a little
 *     even for a perfectly still limb, and dividing that jitter by a small
 *     real dt can spike "velocity" across the threshold with no real motion
 *     behind it; requiring a sustained crossing (real flaps easily clear
 *     this, single-sample noise usually doesn't) is what stops a raised-but-
 *     still hand from firing a phantom flap.
 *   - swinging: tracking total downward travel. Ends (and may fire) once
 *     velocity settles back below FLAP_START_VELOCITY * FLAP_SETTLE_FRACTION
 *     for FLAP_SETTLE_MS straight — not just one sample, for the same jitter
 *     reason as above, applied to the opposite edge (a single noisy dip
 *     mid-swing would otherwise read as "the swing is done" while the arm is
 *     still actively moving). A slow continuous drift that never settles
 *     times out after FLAP_MAX_SWING_MS and fires nothing.
 *   - cooldown: refractory period after a fired flap, so the tail end of a
 *     real downswing (still noisily settling out) can't start a second swing
 *     and fire again before the arm has actually stopped.
 *
 * A completed swing only counts as a flap if its total travel clears
 * FLAP_MIN_TRAVEL (real motion, not jitter) and both wrists individually
 * moved downward over the swing (rejects a single-arm scratch/wave).
 *
 * Every flap applies the same fixed jump (see physics.ts's FLAP_IMPULSE) —
 * there's no strength/magnitude signal, deliberately: it was tried and made
 * jump height unpredictable, which is worse than useful for aiming pipes.
 *
 * Velocity and all the timing checks above are measured against real elapsed
 * time (dtMs, passed in by the caller each frame), not frame count. Webcams
 * rarely deliver a steady 60fps — under load or on slower hardware the
 * actual rate can dip well below that — and a per-frame (rather than
 * per-second) velocity measurement would silently under-read fast swings
 * whenever the camera is running slower: fewer samples across the same
 * swing means the fixed-size smoothing window covers proportionally more of
 * the motion, flattening it. Working in real time keeps detection consistent
 * regardless of camera performance.
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
};
const REQUIRED = [IDX.L_SHOULDER, IDX.R_SHOULDER, IDX.L_WRIST, IDX.R_WRIST];

/**
 * The single visibility rule shared by in-game detection and the camera-check
 * page, so "ready" on the check screen can never disagree with the game.
 */
export function isBodyVisible(landmarks: Landmark[] | undefined | null): boolean {
  return isVisible(landmarks, REQUIRED, CONFIG.VISIBILITY_THRESHOLD);
}

export interface DetectorResult {
  detected: boolean;
  visible: boolean;
  flapped: boolean;
}

/**
 * Tracks how long a boolean condition has held continuously — the instant it
 * breaks, the clock resets to 0. "Has velocity been above threshold long
 * enough to confirm a swing" and "has velocity been below threshold long
 * enough to confirm a settle" are the same pattern applied to opposite
 * conditions, so both use this instead of two hand-rolled counters.
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

type Phase = "idle" | "pendingStart" | "swinging" | "cooldown";

export class FlapDetector {
  private lWristMA!: MovingAverage;
  private rWristMA!: MovingAverage;

  private prevL: number | null = null;
  private prevR: number | null = null;

  private phase: Phase = "idle";
  private startHold = new HoldTimer();
  private settleHold = new HoldTimer();
  private pendingStartL = 0; // wrist positions from just before the current pendingStart run began
  private pendingStartR = 0;
  private swingStartL = 0; // wrist positions from the confirmed start of the current swing
  private swingStartR = 0;
  private swingMs = 0;
  private cooldownMs = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.lWristMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);
    this.rWristMA = new MovingAverage(CONFIG.SMOOTHING_WINDOW);

    this.prevL = null;
    this.prevR = null;

    this.phase = "idle";
    this.startHold.reset();
    this.settleHold.reset();
    this.pendingStartL = 0;
    this.pendingStartR = 0;
    this.swingStartL = 0;
    this.swingStartR = 0;
    this.swingMs = 0;
    this.cooldownMs = 0;
  }

  /** `dtMs` is the real elapsed time since the previous call, so velocity/timing are frame-rate independent. */
  update(landmarks: Landmark[] | undefined | null, dtMs: number): DetectorResult {
    if (!landmarks) return { detected: false, visible: false, flapped: false };

    const visible = isBodyVisible(landmarks);
    if (!visible) return { detected: true, visible: false, flapped: false };

    const lSh = landmarks[IDX.L_SHOULDER];
    const rSh = landmarks[IDX.R_SHOULDER];
    const lWr = landmarks[IDX.L_WRIST];
    const rWr = landmarks[IDX.R_WRIST];

    const shoulderCenterY = (lSh.y + rSh.y) / 2;
    const shoulderWidth = Math.max(Math.abs(lSh.x - rSh.x), CONFIG.MIN_SHOULDER_WIDTH);

    // Vertical signal relative to shoulder height, scaled by shoulder width so detection
    // works regardless of how close the player stands to the camera. Negative = wrist
    // above shoulders (raised), positive = below (lowered).
    const rawL = (lWr.y - shoulderCenterY) / shoulderWidth;
    const rawR = (rWr.y - shoulderCenterY) / shoulderWidth;

    const l = this.lWristMA.push(rawL);
    const r = this.rWristMA.push(rawR);

    // First valid frame: seed state, nothing to compare against yet.
    if (this.prevL === null || this.prevR === null) {
      this.prevL = l;
      this.prevR = r;
      return { detected: true, visible: true, flapped: false };
    }

    const arm = (l + r) / 2;
    const prevArm = (this.prevL + this.prevR) / 2;
    // Shoulder-widths per second, not per frame — see the file header for why.
    const armVel = (arm - prevArm) / (Math.max(dtMs, 1) / 1000);
    let flapped = false;

    if (this.phase === "cooldown") {
      this.cooldownMs -= dtMs;
      if (this.cooldownMs <= 0) this.phase = "idle";
    } else if (this.phase === "idle" || this.phase === "pendingStart") {
      const aboveStart = armVel > CONFIG.FLAP_START_VELOCITY;
      const held = this.startHold.tick(aboveStart, dtMs);

      if (aboveStart && held === dtMs) {
        // First frame of a new above-threshold run — remember the position from
        // just before it started, so once confirmed the swing's travel is
        // measured from the true start, not from FLAP_START_CONFIRM_MS in.
        this.pendingStartL = this.prevL;
        this.pendingStartR = this.prevR;
        this.phase = "pendingStart";
      } else if (!aboveStart) {
        this.phase = "idle"; // was just a blip, never confirmed
      } else if (held >= CONFIG.FLAP_START_CONFIRM_MS) {
        this.phase = "swinging";
        this.swingStartL = this.pendingStartL;
        this.swingStartR = this.pendingStartR;
        this.swingMs = 0;
        this.settleHold.reset();
      }
    } else {
      // "swinging"
      this.swingMs += dtMs;

      const belowSettle = armVel < CONFIG.FLAP_START_VELOCITY * CONFIG.FLAP_SETTLE_FRACTION;
      const settled = this.settleHold.tick(belowSettle, dtMs) >= CONFIG.FLAP_SETTLE_MS;
      const timedOut = this.swingMs >= CONFIG.FLAP_MAX_SWING_MS;

      if (settled || timedOut) {
        if (!timedOut) {
          const lTravel = l - this.swingStartL;
          const rTravel = r - this.swingStartR;
          // Both wrists must have net-moved downward over the swing, not just
          // one, so a single-arm scratch/wave can't register as a flap.
          const bothDescended = lTravel > 0 && rTravel > 0;
          const travel = (lTravel + rTravel) / 2;

          if (travel >= CONFIG.FLAP_MIN_TRAVEL && bothDescended) {
            flapped = true;
            this.cooldownMs = CONFIG.FLAP_COOLDOWN_MS;
          }
        }
        this.phase = flapped ? "cooldown" : "idle";
        this.startHold.reset();
      }
    }

    this.prevL = l;
    this.prevR = r;

    return { detected: true, visible: true, flapped };
  }
}

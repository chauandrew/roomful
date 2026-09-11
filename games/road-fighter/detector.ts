/**
 * Road Fighter pose classification: a 5-way Hadoken/Shoryuken/Straight
 * Punch/Guard/Sonic Boom detector. Every signal is "what shape is the body
 * in right now" (one landmark relative to another in the SAME frame) rather
 * than deviation from a calibrated neutral stance — unlike reflex-runner's
 * lane/duck, none of these moves are about how far the player has moved
 * from standing normally. calibrate() only locks a stable shoulderWidth
 * normalizer, not a baseline position, so callers are expected to call it
 * repeatedly (every frame, in practice) rather than once — see Play.tsx's
 * COUNTDOWN handling and Tutorial.tsx's TEACHING handling, both of which
 * recalibrate continuously so the denominator self-heals from a dropout and
 * tracks a player who drifts closer to or farther from the camera.
 *
 * Every move is upper-body only (shoulders/wrists/hips) — no move needs legs
 * in frame, so players only need to fit from about the waist up.
 *
 * Players face the camera directly (not bladed), so a forward strike like
 * Hadoken is mostly depth-axis motion in camera space — reach is computed
 * with the landmarks' z coordinate included, not just x/y, so pushing
 * straight at the camera registers as reach the same as pushing sideways
 * would.
 */
import { isVisible } from "@/lib/tracking/signals";
import type { Landmark } from "@/lib/tracking/types";
import { CONFIG, type Pose } from "./config";

// BlazePose (MediaPipe Pose) landmark indices this detector relies on.
export const IDX = {
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
};
const REQUIRED = Object.values(IDX);

/**
 * Upper-body visibility check for CAMERA_CHECK gating — every move here only
 * needs shoulders/wrists/hips, so players just need to fit from the waist
 * up, unlike the full-body games elsewhere in this codebase.
 */
export function isUpperBodyVisible(landmarks: Landmark[] | undefined | null): boolean {
  return isVisible(landmarks, REQUIRED, CONFIG.VISIBILITY_THRESHOLD);
}

export interface DetectorResult {
  visible: boolean; // were the required landmarks visible/present this frame
  candidate: Pose | null; // this frame's raw classification (or null if ambiguous/no clean match)
  locked: Pose | null; // non-null for exactly the one update() call where a candidate first reaches CONFIG.STABLE_MS held
}

export class PoseFighterDetector {
  private shoulderWidth = CONFIG.MIN_SHOULDER_WIDTH;
  private calibrated = false;

  private currentCandidate: Pose | null = null;
  private heldMs = 0;
  private alreadyLocked = false;

  reset() {
    this.shoulderWidth = CONFIG.MIN_SHOULDER_WIDTH;
    this.calibrated = false;

    this.startRound();
  }

  /**
   * Clears only this round's pose-lock progress, leaving calibration intact —
   * call at the start of every round after the first.
   */
  startRound() {
    this.currentCandidate = null;
    this.heldMs = 0;
    this.alreadyLocked = false;
  }

  /**
   * Locks a stable shoulderWidth normalizer for the whole match, so per-move
   * geometry stays comparable frame to frame even as a player twists
   * mid-move. Returns false (and leaves any prior value untouched) if the
   * required landmarks are missing.
   */
  calibrate(landmarks: Landmark[] | undefined | null): boolean {
    if (!isUpperBodyVisible(landmarks)) return false;
    const l = landmarks!;
    const lSh = l[IDX.L_SHOULDER];
    const rSh = l[IDX.R_SHOULDER];

    this.shoulderWidth = Math.max(Math.abs(lSh.x - rSh.x), CONFIG.MIN_SHOULDER_WIDTH);
    this.calibrated = true;
    return true;
  }

  /** `dtMs` is the real elapsed time since the previous call, so timing is frame-rate independent. */
  update(landmarks: Landmark[] | undefined | null, dtMs: number): DetectorResult {
    const visible = isUpperBodyVisible(landmarks);
    if (!this.calibrated || !visible) {
      // Not calibrated yet, or a dropout — don't advance the hold timer, a
      // dropout shouldn't quietly count toward a lock.
      return { visible: false, candidate: null, locked: null };
    }

    const l = landmarks!;
    const lSh = l[IDX.L_SHOULDER];
    const rSh = l[IDX.R_SHOULDER];
    const lWrist = l[IDX.L_WRIST];
    const rWrist = l[IDX.R_WRIST];
    const lHip = l[IDX.L_HIP];
    const rHip = l[IDX.R_HIP];

    const shoulderCenterY = (lSh.y + rSh.y) / 2;
    const hipCenterY = (lHip.y + rHip.y) / 2;

    const leftReach = Math.hypot(lWrist.x - lSh.x, lWrist.y - lSh.y, lWrist.z - lSh.z) / this.shoulderWidth;
    const rightReach = Math.hypot(rWrist.x - rSh.x, rWrist.y - rSh.y, rWrist.z - rSh.z) / this.shoulderWidth;
    const avgReach = (leftReach + rightReach) / 2;
    // A "how close to the body does this look" check (Punch's tucked arm)
    // needs the 2D-only version, NOT the z-inclusive one above — a hand held
    // near your ribs is still naturally a little forward of your shoulder in
    // depth, and that alone can push the 3D reach over the "tucked"
    // threshold even though the pose looks perfectly tucked in on camera. z
    // only matters for "is this arm pushed OUT," not "is it in."
    const leftReach2D = Math.hypot(lWrist.x - lSh.x, lWrist.y - lSh.y) / this.shoulderWidth;
    const rightReach2D = Math.hypot(rWrist.x - rSh.x, rWrist.y - rSh.y) / this.shoulderWidth;
    const armSpread = Math.abs(lWrist.x - rWrist.x) / this.shoulderWidth;
    const wristGap = Math.abs(lWrist.y - rWrist.y) / this.shoulderWidth;
    const oneArmRaised =
      Math.min(lWrist.y, rWrist.y) < shoulderCenterY - CONFIG.SHORYUKEN_RAISE_MARGIN * this.shoulderWidth;
    // Which wrist is the raised one, and how far it's actually extended — a
    // hand barely lifted off a resting position also clears the small raise
    // margin above, so Shoryuken additionally requires that wrist to be
    // genuinely reaching, not just slightly higher than the other.
    const raisedWristReach = lWrist.y < rWrist.y ? leftReach : rightReach;
    // The OTHER wrist must actually be down at/below shoulder height, not
    // just lower than the raised one — Sonic Boom's two hands are rarely
    // raised to perfectly even heights, and that unevenness alone can clear
    // the gap threshold above even though neither hand is actually down.
    const otherWristDown = Math.max(lWrist.y, rWrist.y) > shoulderCenterY;
    // Guard is the Wakanda pose — arms crossed over the chest, each fist near
    // the OPPOSITE shoulder. Crossing is the distinctive signal: the wrists
    // have swapped which side of the body they're on, relative to how the
    // shoulders are ordered. Comparing wrist order against shoulder order
    // (rather than assuming which absolute x-direction is "left") makes this
    // correct regardless of whether MediaPipe's raw (unmirrored) camera
    // frame happens to put a given landmark's own left/right on the smaller
    // or larger x side — a hardcoded assumption there was exactly backwards
    // and meant a real crossed pose could never satisfy it.
    const armsCrossed = (rWrist.x - lWrist.x) * (rSh.x - lSh.x) < 0;
    const leftCrossReach2D = Math.hypot(lWrist.x - rSh.x, lWrist.y - rSh.y) / this.shoulderWidth;
    const rightCrossReach2D = Math.hypot(rWrist.x - lSh.x, rWrist.y - lSh.y) / this.shoulderWidth;
    const avgCrossReach2D = (leftCrossReach2D + rightCrossReach2D) / 2;
    // Both wrists raised well above the shoulder line — Sonic Boom's signal.
    // Reaching straight up stays in each player's own column instead of
    // sideways into their neighbor's, unlike a wide horizontal spread would
    // for two players standing close together.
    const bothArmsRaised =
      lWrist.y < shoulderCenterY - CONFIG.SONICBOOM_RAISE_MARGIN * this.shoulderWidth &&
      rWrist.y < shoulderCenterY - CONFIG.SONICBOOM_RAISE_MARGIN * this.shoulderWidth;
    // A hanging arm has roughly the same shoulder-to-wrist DISTANCE as an
    // extended one (both are just a mostly-straight arm, pointed a different
    // way) — reach alone can't tell them apart, so Hadoken/Sonic Boom also
    // require both wrists to stay above hip height, which a resting arm at
    // your sides does not.
    const armsNotHanging =
      lWrist.y < hipCenterY + CONFIG.HANGING_ARM_MARGIN * this.shoulderWidth &&
      rWrist.y < hipCenterY + CONFIG.HANGING_ARM_MARGIN * this.shoulderWidth;
    // One arm reaching out while the other stays tucked in — Straight
    // Punch's signal, orthogonal to everything else: Shoryuken's asymmetry
    // is about HEIGHT (one wrist up, one down), this is about REACH (one
    // wrist far, one close), regardless of height. A gap alone isn't
    // enough — two arms that are BOTH extended, just not evenly (Hadoken
    // pushed slightly off-center), can clear the gap threshold too, so the
    // shorter arm must also actually be tucked in close, not just shorter.
    // The gap itself is measured as the reaching arm's 3D reach (so punching
    // straight at the camera counts fully) against the OTHER arm's 2D-only
    // reach — using 3D for both would let the tucked arm's incidental depth
    // (same issue as Guard above) quietly shrink the gap.
    const leftIsFurther = leftReach >= rightReach;
    const extendedReach = leftIsFurther ? leftReach : rightReach;
    const tuckedReach2D = leftIsFurther ? rightReach2D : leftReach2D;
    const reachAsymmetry = extendedReach - tuckedReach2D;
    const tuckedArm = Math.min(leftReach2D, rightReach2D) < CONFIG.TUCKED_REACH_MAX;

    // Most-distinctive-signal-first, so ambiguous cases fall through cleanly
    // rather than being claimed by the wrong move. Shoryuken (height
    // asymmetry), Straight Punch (reach asymmetry), and Guard (crossed
    // wrists) are all structurally unique among this set, so they're checked
    // first; Sonic Boom (both arms raised overhead) is checked before
    // Hadoken since a narrow, raised reach would otherwise also satisfy
    // Hadoken's condition.
    let candidate: Pose | null;
    if (oneArmRaised && wristGap > CONFIG.SHORYUKEN_GAP_THRESHOLD && raisedWristReach > CONFIG.TUCKED_REACH_MAX && otherWristDown) {
      candidate = "shoryuken";
    } else if (reachAsymmetry > CONFIG.PUNCH_ASYMMETRY_THRESHOLD && extendedReach > CONFIG.EXTEND_REACH_MIN && tuckedArm) {
      candidate = "punch";
    } else if (armsCrossed && avgCrossReach2D < CONFIG.GUARD_REACH_MAX && armsNotHanging) {
      candidate = "guard";
    } else if (avgReach > CONFIG.EXTEND_REACH_MIN && armsNotHanging && bothArmsRaised) {
      candidate = "sonicboom";
    } else if (avgReach > CONFIG.EXTEND_REACH_MIN && armsNotHanging && armSpread < CONFIG.HADOKEN_SPREAD_MAX) {
      candidate = "hadoken";
    } else {
      candidate = null;
    }

    if (candidate !== this.currentCandidate) {
      this.currentCandidate = candidate;
      this.heldMs = 0;
      this.alreadyLocked = false;
    } else {
      this.heldMs += dtMs;
    }

    let locked: Pose | null = null;
    if (!this.alreadyLocked && this.currentCandidate !== null && this.heldMs >= CONFIG.STABLE_MS) {
      locked = this.currentCandidate;
      this.alreadyLocked = true; // latches so this doesn't refire on subsequent calls
    }

    return { visible: true, candidate, locked };
  }
}

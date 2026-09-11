export type Pose = "hadoken" | "shoryuken" | "punch" | "guard" | "sonicboom";

/**
 * RPS-Lizard-Spock style: each move beats exactly 2 others and loses to
 * exactly 2 others (a pentagram, not a simple 3-way cycle). BEATS[a] is the
 * pair a beats.
 */
export const BEATS: Record<Pose, [Pose, Pose]> = {
  hadoken: ["shoryuken", "guard"],
  shoryuken: ["sonicboom", "punch"],
  punch: ["hadoken", "guard"],
  guard: ["shoryuken", "sonicboom"],
  sonicboom: ["hadoken", "punch"],
};

export const CONFIG = {
  // --- Round ---
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 1200,
  READY_STABILITY_MS: 1000, // continuous upper-body tracking required before CAMERA_CHECK auto-advances
  // How long the "FIGHT!" label stays up — also the pose window: players
  // must strike and hold a pose before this elapses, or they lose the round.
  POSE_WINDOW_MS: 1800,
  STABLE_MS: 300, // how long a candidate pose must hold continuously before it locks in
  STARTING_LIVES: 3,
  ROUND_RESULT_MS: 2000, // how long the reveal screen holds before auto-advancing to the next round

  // --- Pose classification ---
  // Every signal is "what shape is the body in right now" (one landmark
  // relative to another in the SAME frame), normalized by shoulder width —
  // not deviation from a calibrated neutral stance, since none of these 5
  // moves are about how far the player moved from standing normally. All
  // values are starting guesses, expected to move once tuned against real
  // playtesting. Every signal is upper-body only (shoulders/wrists/hips) —
  // no move needs legs in frame, so the camera only needs to see from about
  // the waist up. Priority order (most distinctive first): Shoryuken (arm
  // height asymmetry) -> Straight Punch (arm reach asymmetry) -> Guard
  // (crossed wrists) -> Sonic Boom (both arms raised overhead) -> Hadoken
  // (extended forward, narrow spread).
  SHORYUKEN_RAISE_MARGIN: 0.1, // the raised wrist must clear this far above the shoulder line (x shoulderWidth)
  SHORYUKEN_GAP_THRESHOLD: 0.7, // vertical gap between the two wrists (x shoulderWidth) needed for the up/down asymmetry
  PUNCH_ASYMMETRY_THRESHOLD: 0.4, // gap between the two arms' reach (x shoulderWidth) needed for one-arm-out, one-arm-tucked
  // "Tucked in" — Straight Punch's non-extended arm, and the floor Shoryuken's
  // raised wrist must clear so a barely-lifted hand doesn't count.
  TUCKED_REACH_MAX: 0.7,
  // Guard's ceiling on how close each wrist must land to the OPPOSITE
  // shoulder (see leftCrossReach2D below) for a crossed-arms pose to count as
  // tucked against the chest, not just loosely crossed.
  GUARD_REACH_MAX: 0.85,
  // Reach alone can't tell "arms extended forward" from "arms hanging at
  // your sides" (both are just a mostly-straight arm, different direction) —
  // HANGING_ARM_MARGIN below gates Hadoken/Sonic Boom on the wrist staying
  // above hip height so a resting stance can't satisfy either.
  EXTEND_REACH_MIN: 0.85, // average (or, for Straight Punch, the extended arm's) reach must exceed this
  HANGING_ARM_MARGIN: 0.3, // both wrists must stay above hipCenterY + this much (x shoulderWidth) for Hadoken/Sonic Boom — rules out arms just hanging at your sides
  HADOKEN_SPREAD_MAX: 1.3, // wrist-to-wrist spread must stay under this (x shoulderWidth) for Hadoken
  SONICBOOM_RAISE_MARGIN: 0.3, // both wrists must clear this far above the shoulder line (x shoulderWidth) for Sonic Boom
  MIN_SHOULDER_WIDTH: 0.05, // floor for the shoulder-width normalizer, like reflex-runner's MIN_SHOULDER_WIDTH
  VISIBILITY_THRESHOLD: 0.5, // per-landmark visibility floor for isUpperBodyVisible

  // --- Attribution ---
  MIN_POSE_SPAN: 0.12, // minimum torso span (shoulder-to-hip midpoint distance, aspect-corrected) to count as a real nearby player

  // --- Players ---
  PLAYER_COLORS: ["#4ade80", "#60a5fa"] as [string, string], // [Player 1 (screen-left), Player 2 (screen-right)]
};

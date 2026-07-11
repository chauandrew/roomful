/**
 * Floss Rush — all tunable constants live here.
 * Adjust detection feel, scoring, and game rules in one place.
 */
export const CONFIG = {
  // --- Pose / detection ---
  VISIBILITY_THRESHOLD: 0.5, // min landmark visibility (0..1) before we count anything
  MIN_SHOULDER_WIDTH: 0.05, // floor for shoulder-width normalization (avoids divide-by-zero)
  SMOOTHING_WINDOW: 3, // moving-average frames for the horizontal (x) arm/hip signals
  // (keep short: a fast swing is only ~4-6 frames at 30fps, and a window that
  // long flattens it below AMPLITUDE_THRESHOLD)
  DEPTH_SMOOTHING_WINDOW: 10, // longer moving-average for the noisy z (depth) signal
  VELOCITY_DEADZONE: 0.004, // min |velocity| (normalized units/frame) to register motion

  // --- Floss heuristic ---
  AMPLITUDE_THRESHOLD: 0.35, // min peak-to-peak arm travel (in shoulder-widths) for a real swing
  OPPOSITION_TOLERANCE: 0.25, // require avg opposition score <= -this over the swing (-1=perfectly opposite)
  DEPTH_SEPARATION_THRESHOLD: 0.06, // min |leftWristZ - rightWristZ| before we trust the front/behind sign

  // --- Scoring (swing count weighted by width) ---
  BASE_POINTS: 1, // points for a just-qualifying swing
  MIN_WIDTH: 0.35, // width (shoulder-widths) that earns BASE_POINTS
  WIDTH_STEP: 0.4, // each extra WIDTH_STEP of width adds 1 point
  MAX_POINTS_PER_SWING: 5, // cap so one giant swing can't run away with the score

  // --- Game loop ---
  GAME_DURATION_MS: 15000,
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 900,
  COUNTDOWN_GO_MS: 600,
  READY_STABILITY_MS: 1000, // continuous tracking required before the Ready button enables

  // --- Leaderboard (local stand-in; see leaderboard.ts) ---
  MAX_PLAUSIBLE_SCORE: 400, // clamp; tune to (max human swings) * MAX_POINTS_PER_SWING
  NAME_MAX_LEN: 20,
  LEADERBOARD_SIZE: 10,

  // --- Display ---
  SHOW_SKELETON: true,
};

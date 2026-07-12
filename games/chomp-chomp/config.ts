/**
 * Chomp Chomp — all tunable constants live here.
 */
export const CONFIG = {
  // --- Face tracking ---
  MOUTH_SMOOTHING_WINDOW: 4, // moving-average frames for the mouth-open ratio

  // --- Calibration ---
  CALIBRATION_HOLD_MS: 1000, // how long each calibration step waits before capturing
  MIN_MOUTH_RANGE: 0.03, // min (max - min) mouth ratio spread; below this, calibration fails
  OPEN_THRESHOLD_FRACTION: 0.4, // open threshold sits 40% of the way from min to max

  // --- Dot grid ---
  DOT_GRID_COLS: 5,
  DOT_GRID_ROWS: 5,
  DOT_MARGIN_FRACTION: 0.18, // fraction of width/height kept clear at each edge
  DOT_RADIUS: 10,
  DOT_HIT_RADIUS: 45, // px between face-cursor and a dot for it to count as eaten
  DOT_COLOR: "#f4d03f",

  // --- Wedge ---
  WEDGE_RADIUS: 70,
  WEDGE_MIN_ANGLE_DEG: 8, // total mouth-gap angle when fully closed (thin sliver)
  WEDGE_MAX_ANGLE_DEG: 75, // total mouth-gap angle when fully open
  WEDGE_FILL: "rgba(244, 208, 63, 0.45)",
  WEDGE_STROKE: "rgba(244, 208, 63, 0.95)",
  WEDGE_LINE_WIDTH: 3,

  // --- Game loop ---
  ROUND_DURATION_MS: 20000,
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 900,
  COUNTDOWN_GO_MS: 600,
  READY_STABILITY_MS: 1000, // continuous face tracking required before Ready enables

  // --- Local best (session-only) ---
  BEST_SCORE_KEY: "chomp-chomp:best",
};

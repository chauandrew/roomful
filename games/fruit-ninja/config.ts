/**
 * Fruit Ninja — gameplay knobs live here. Engine tuning (hand-slot tracking)
 * lives in lib/fruit-ninja/handTracker.ts as DEFAULT_TRACKER_TUNING.
 */
export const CONFIG = {
  // --- Round ---
  ROUND_DURATION_MS: 45000,
  LIVES: 3, // shared between both players; a missed fruit costs one (a sliced bomb ends the round instantly, no lives involved)
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 900,
  COUNTDOWN_GO_MS: 600,
  READY_STABILITY_MS: 1000, // continuous hand tracking required before Ready enables

  // --- Spawning (difficulty ramps linearly across the round) ---
  SPAWN_INTERVAL_START_MS: 1300, // time between launches at 0:00
  SPAWN_INTERVAL_END_MS: 450, // time between launches at 0:45
  LAUNCH_SPEED_START: 1.4, // upward launch speed at 0:00, screen-heights/s (peaks ~80% up the frame)
  LAUNCH_SPEED_END: 1.65, // upward launch speed at 0:45 (briefly clears the top of the frame)
  LAUNCH_VX_MAX: 0.25, // max sideways drift, screen-widths/s, aimed loosely toward center
  SPAWN_X_MARGIN: 0.15, // fraction of width kept clear of each edge at launch
  BOMB_PROBABILITY: 0.15, // chance any given launch is a bomb instead of fruit

  // --- Physics ---
  GRAVITY: 1.2, // screen-heights/s^2 (start-speed arc is airborne ~2.3s)
  FRUIT_RADIUS: 0.06, // hit-circle radius, fraction of screen height
  BOMB_RADIUS: 0.055,
  FRUIT_COLORS: ["#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa", "#c084fc"],

  // --- Scoring ---
  SCORE_PER_FRUIT: 10,
  COMBO_ENABLED: true, // bonus when one hand's stroke cuts several fruit at once
  COMBO_BONUS: 5, // extra points per additional fruit beyond the first in one stroke

  // --- Effects ---
  SPLASH_MS: 300, // how long a slice splash ring lingers

  // --- Leaderboard (local stand-in; see leaderboard.ts) ---
  MAX_PLAUSIBLE_SCORE: 1200, // clamp; hard ceiling is ~100 launches/round at max rate x 10/fruit, plus combo headroom
  NAME_MAX_LEN: 20,
  LEADERBOARD_SIZE: 10,
  BEST_SCORE_KEY: "fruit-ninja:best",
};

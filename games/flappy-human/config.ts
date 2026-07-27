/**
 * Flappy Human — all tunable constants live here.
 * Adjust detection feel, physics, difficulty ramp, and game rules in one place.
 */
export const CONFIG = {
  // --- Pose / detection ---
  VISIBILITY_THRESHOLD: 0.5, // min landmark visibility (0..1) before we count anything
  MIN_SHOULDER_WIDTH: 0.05, // floor for shoulder-width normalization (avoids divide-by-zero)
  SMOOTHING_WINDOW: 3, // moving-average frames for the vertical (y) arm signal

  // --- Flap heuristic ---
  // Detects any downward arm swing directly (no raise-first requirement): a
  // swing starts once downward velocity clears FLAP_START_VELOCITY, and
  // completes (and may fire) once velocity settles back down. See detector.ts.
  //
  // All velocity/timing values here are in real-time units (shoulder-widths
  // PER SECOND, and milliseconds) rather than per-frame — webcam frame rate
  // varies a lot in practice (CPU load, hardware, browser), and per-frame
  // units would make detection inconsistent (and specifically under-read
  // fast swings) whenever the camera runs slower than expected.
  FLAP_START_VELOCITY: 0.36, // downward velocity (shoulder-widths/sec) that begins tracking a swing
  FLAP_START_CONFIRM_MS: 40, // velocity must stay above FLAP_START_VELOCITY this long before a swing is confirmed real (rejects single-sample jitter spikes)
  FLAP_SETTLE_FRACTION: 0.4, // swing is "done" once velocity drops back below FLAP_START_VELOCITY * this fraction
  FLAP_SETTLE_MS: 50, // consecutive low-velocity time required before a swing counts as settled (rejects one noisy dip mid-swing)
  FLAP_COOLDOWN_MS: 250, // refractory period after a fired flap before a new swing can start
  FLAP_MIN_TRAVEL: 0.05, // minimum net downward travel (shoulder-widths) over the swing to count as a real flap
  FLAP_MAX_SWING_MS: 1500, // safety cap so a slow continuous drift can't get stuck mid-swing forever

  // --- Logical game space (canvas is scaled to this at draw time) ---
  GAME_W: 480,
  GAME_H: 720,

  // --- Bird ---
  BIRD_X: 120, // fixed horizontal position (world scrolls, bird doesn't move in x)
  BIRD_RADIUS: 18,
  FLAP_IMPULSE: -560, // upward velocity (game units/s) applied on every flap; fixed, doesn't scale with effort

  // --- Difficulty ramp: gentle at t=0 -> classic Flappy Bird feel at t=RAMP_DURATION_MS ---
  // Made generally easier per playtesting: slower fall (both ends of the
  // gravity ramp lowered ~15-18%) plus a wider pipe gap throughout, so
  // there's more time to react and more room for error. Pipe speed and flap
  // impulse left untouched so the effect of these two changes stays legible.
  RAMP_DURATION_MS: 30_000,
  GRAVITY_START: 760, // game units/s^2
  GRAVITY_END: 1500,
  PIPE_SPEED_START: 110, // game units/s
  PIPE_SPEED_END: 220,
  PIPE_GAP_START: 285, // vertical gap height, game units
  PIPE_GAP_END: 175,
  PIPE_WIDTH: 70,
  PIPE_SPACING: 300, // horizontal distance between consecutive pipe pairs
  PIPE_CAP_HEIGHT: 24, // classic Mario-pipe lip detail
  COLLISION_FORGIVENESS: 6, // px shrunk from the bird's hitbox for a slightly forgiving feel

  // --- Game loop / camera check ---
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 900,
  COUNTDOWN_GO_MS: 600,
  READY_STABILITY_MS: 1000,
  // Presentation-only bob shown behind the countdown (not real physics —
  // gameplay itself starts with no hover phase the instant PLAYING begins).
  COUNTDOWN_BOB_AMPLITUDE: 10, // px of bob
  COUNTDOWN_BOB_PERIOD_MS: 1400,

  // --- Leaderboard (local stand-in; see leaderboard.ts) ---
  MAX_PLAUSIBLE_SCORE: 500,
  NAME_MAX_LEN: 20,
  LEADERBOARD_SIZE: 10,

  // --- Camera preview-in-corner ---
  CAMERA_PIP_WIDTH: 320,
  CAMERA_PIP_HEIGHT: 240,

  // --- Audio ---
  BG_MUSIC_SRC: "/audio/flappy-human/happy-adventure-loop.mp3",
  BG_MUSIC_VOLUME: 0.35,

  // --- Bird sprite (original hand-drawn SVG art, rendered to PNG) ---
  BIRD_SPRITE_UP: "/images/flappy-human/bird-up.png",
  BIRD_SPRITE_DOWN: "/images/flappy-human/bird-down.png",
  BIRD_SPRITE_HIT: "/images/flappy-human/bird-hit.png",
};

/**
 * Reflex Runner — all tunable constants live here.
 * Adjust detection feel, physics, difficulty ramp, and game rules in one place.
 */
export const CONFIG = {
  // --- Pose / detection ---
  VISIBILITY_THRESHOLD: 0.5, // min landmark visibility (0..1) before we count anything
  MIN_SHOULDER_WIDTH: 0.05, // floor for shoulder-width normalization (avoids divide-by-zero)
  SMOOTHING_WINDOW: 3, // moving-average frames for the shoulder-center signals

  // --- Baseline calibration ---
  // Captured once, from the shoulder-center position held during CameraCheck's
  // READY_STABILITY_MS window. Every signal below is measured relative to that
  // baseline and normalized by shoulder width, so detection works regardless
  // of the player's height, distance from camera, or position in frame.

  // --- Lane (lean left/right) ---
  // Positional, not a transient event: the player IS in whichever lane band
  // their shoulder center currently falls in. LANE_EXIT_THRESHOLD is
  // narrower than LANE_ENTER_THRESHOLD (hysteresis) so a lean sitting right
  // at the boundary can't flicker between lanes every frame.
  LANE_ENTER_THRESHOLD: 0.35, // shoulder-widths of lean from baseline to ENTER a side lane
  LANE_EXIT_THRESHOLD: 0.2, // must lean back within this band to EXIT a side lane back toward center

  // --- Duck (crouch) ---
  // Positional-hold on the same vertical signal jump uses, opposite sign.
  // A real jump's crouch windup will cross DUCK_ENTER briefly — that's
  // expected and must never be treated as a miss on its own; only "a duck
  // obstacle reached the player while NOT ducking" costs a life.
  DUCK_ENTER_THRESHOLD: 0.3, // shoulder-widths downward from baseline to count as ducking
  DUCK_EXIT_THRESHOLD: 0.18,

  // --- Jump (hop) ---
  // The only transient/event signal: a fast upward excursion past baseline,
  // confirmed briefly (rejects landmark jitter), then a cooldown so the
  // settling tail of one jump can't trigger a second.
  JUMP_RISE_THRESHOLD: -0.28, // shoulder-widths upward (negative) from baseline that starts confirming a jump
  JUMP_CONFIRM_MS: 30, // must clear JUMP_RISE_THRESHOLD continuously this long before it fires (rejects single-sample jitter)
  JUMP_COOLDOWN_MS: 500, // refractory period after a fired jump before a new one can start

  // --- Logical game space (canvas is scaled to this at draw time) ---
  GAME_W: 480,
  GAME_H: 720,

  // --- Runner ---
  LANE_COUNT: 3,
  LANE_SWITCH_MS: 140, // tween duration for a visual lane change (collision uses the discrete target lane, not this tween)
  // Jump arc duration ramps DOWN from START to END over RAMP_DURATION_MS (the
  // same clock as speed/spacing below), the opposite direction from
  // everything else — at max speed a full 1080ms jump would keep the player
  // airborne (unable to duck) past the very next obstacle's arrival, an
  // unavoidable death if it's a duck. JUMP_DURATION_END_MS is asserted in
  // physics.test.ts to always leave JUMP_LANDING_BUFFER_MS of real time to
  // land and crouch before the next obstacle can legally arrive, so a
  // hurdle-then-duck at max speed is always survivable — just tight.
  JUMP_DURATION_START_MS: 1080,
  JUMP_DURATION_END_MS: 450,
  JUMP_LANDING_BUFFER_MS: 300, // min ms after landing to get into a duck before the next obstacle arrives, at max speed
  JUMP_HEIGHT: 280, // peak visual height of the jump arc, game units

  // --- World / obstacles ---
  // Obstacles exist on a depth axis "z": they spawn at FAR_Z and scroll
  // toward the player at PLAYER_Z = 0, exactly mirroring how flappy-human's
  // pipes scroll toward BIRD_X — only relabeled as depth instead of a
  // horizontal position, since draw.ts renders z as pseudo-3D perspective.
  PLAYER_Z: 0,
  FAR_Z: 1000, // spawn depth. Must satisfy FAR_Z / SPEED_END >= MIN_REACTION_MS / 1000 (see below) — asserted in physics.test.ts.
  OBSTACLE_THICKNESS: 40, // depth extent of one obstacle, like PIPE_WIDTH

  // --- Difficulty ramp: gentle at t=0 -> fast & dense at t=RAMP_DURATION_MS ---
  RAMP_DURATION_MS: 30_000,
  SPEED_START: 250, // world scroll speed, game z-units/s
  SPEED_END: 500,
  SPACING_START: 700, // z-distance between consecutive obstacles
  SPACING_END: 380,

  // Past this point in the ramp, a spawn sometimes produces two obstacles at
  // once instead of one: a jump or duck hurdle paired with a lane barrier
  // (jump/duck it while also dodging into a safe lane), or two lane barriers
  // in different lanes (always leaves exactly one lane open). Jump and duck
  // never pair together — you can't be airborne and ducking at once. See
  // randomObstacleGroup() in physics.ts.
  DOUBLE_OBSTACLE_START_MS: 10_000,
  DOUBLE_OBSTACLE_CHANCE: 0.3, // fraction of spawns, once past DOUBLE_OBSTACLE_START_MS, that are a pair instead of a single obstacle

  // Minimum time an obstacle must be visible before it reaches the player,
  // at max ramp speed — a hard latency-safety floor. Detector + physics
  // reaction time is roughly ~150-250ms; anything below ~1.2s of warning
  // risks becoming genuinely unfair rather than just hard. A future
  // difficulty tweak that violates this should fail physics.test.ts, not
  // ship silently.
  MIN_REACTION_MS: 1200,

  // --- Game loop / camera check ---
  COUNTDOWN_FROM: 3,
  COUNTDOWN_TICK_MS: 900,
  COUNTDOWN_GO_MS: 600,
  READY_STABILITY_MS: 1000,

  // --- Leaderboard (local stand-in; see leaderboard.ts) ---
  MAX_PLAUSIBLE_SCORE: 5000,
  NAME_MAX_LEN: 20,
  LEADERBOARD_SIZE: 10,

  // --- Camera preview-in-corner ---
  CAMERA_PIP_WIDTH: 320,
  CAMERA_PIP_HEIGHT: 240,
};

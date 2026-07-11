# Plan: Add Floss Rush as a native single-device game

**Status:** Stage 2 complete (2026-07-11). This doc is the source of truth for resuming this work across
sessions — read it fresh at the start of a new session instead of relying on chat history.
Check boxes off as stages complete and commit this file alongside each stage's code so
progress survives between sessions.

## Context

`~/projects/floss-rush` is a fully working, dependency-free vanilla-JS webcam game (15s
"floss as fast/wide as you can," MediaPipe pose tracking, 100% client-side, camera frames
never leave the device). The goal is to bring it into Roomful as a second single-device game
(alongside Gibberish) — **native, not iframed** — because 2-3 more camera/pose-tracking
games are planned after this one, and the camera/model/loop/gating boilerplate should be
built once and shared, not copy-pasted per game. This mirrors how Roomful's multi-user games
already share `hooks/useRoom.ts` + `components/PresenterLayout.tsx` + `components/inputs/`
instead of each reimplementing room plumbing.

Two decisions from prior discussion, worth preserving here so a future session doesn't
re-litigate them:
- `mode: "single-device"` is the correct, sufficient category for floss-rush — no new
  "spotlight" game mode needed. `GameMeta.mode` describes where the game *runs* (one
  screen), not how the audience engages with it (whole room vs. one performer at a time).
- Priority is *depth* in Roomful's existing genres over breadth into a new one — but since
  floss-rush **is** another single-device game, building it satisfies that priority rather
  than competing with it.

Floss-rush's own source (`app.js`, `detector.js`, `config.js`, `leaderboard.js`,
`styles.css`) has been read in full and decomposes cleanly into a generic sensing/UI layer
(→ `lib/tracking/`) and floss-specific detection logic (→ `games/floss-rush/`).

**Explicitly NOT being extracted into the shared layer yet:** floss's actual swing-detection
algorithm (direction-reversal + amplitude threshold + arm/hip opposition gating). It's
tempting to call this generic ("swing detection"), but with only one consumer so far we
don't know if game #2 needs the same shape (a squat dip, a jump peak, a reach are all
different signal shapes). If a second game's detector turns out to need the same
MovingAverage+reversal pattern, *that's* the moment to promote a shared primitive into
`lib/tracking/signals.ts` — not now. (Per this repo's CLAUDE.md: "no abstractions for
single-use code.")

## Stage 1 — Add the MediaPipe dependency, verify it resolves in Next.js ✅ DONE

- [x] `npm install @mediapipe/tasks-vision` (real npm dependency, replacing floss-rush's
      CDN-URL-as-import-specifier trick — Next.js's bundler statically resolves import
      specifiers and can't treat a bare `https://` URL as a module source the way an
      unbundled native `<script type="module">` can; this is what MediaPipe's own official
      Next.js/React examples do). **Pinned to `0.10.12`** (not the `^0.10.35` npm resolved
      by default) — matches the exact version floss-rush's own `TASKS_VERSION` constant was
      built and tested against, avoiding behavioral drift from an untested newer release.
- [x] Checked `node_modules/@mediapipe/tasks-vision/package.json`'s `exports` field — it's
      a clean dual CJS/ESM package (`"type": "module"`, explicit `.mjs`/`.cjs` files, a
      proper `exports` map with `import`/`require`/`default`/`types` conditions). Combined
      with this repo's `tsconfig.json` already using `"moduleResolution": "bundler"`, it
      resolves without needing `transpilePackages` — confirmed by an actual build, not just
      inspection (see below).
- [x] Verified end-to-end, not just "present but unused": added a temporary route
      (`app/smoke-test-mediapipe/page.tsx`) importing `FilesetResolver`/`PoseLandmarker`
      from the package, ran a clean `npm run build` (deleted `.next` first), confirmed the
      route appeared in the build output and **prerendered as static** — proving there's no
      SSR-breaking side effect at module-import scope, not just that webpack/Turbopack could
      bundle it. Loaded the route in a real browser: page rendered, zero console errors.
      Deleted the temporary route and lib file afterward — Stage 2 builds the real thing.
      `npx tsc --noEmit`, `npm run lint`, and `npm run build` all pass clean on the
      resulting tree (just `package.json`/`package-lock.json` changed).
- [x] Adversarial review (background agent) caught that `npm install` had written
      `"^0.10.12"` (a caret range) to `package.json` despite the stated "exact pin" intent —
      the caret would let a later `npm install`/`npm update` float to `0.10.35`. Fixed to a
      bare `"0.10.12"` and re-ran `npm install` to sync the lockfile; `tsc`/`lint`/`build`
      re-verified clean afterward.

Note: the large WASM/model binaries stay CDN-fetched at *runtime* via
`FilesetResolver.forVisionTasks(url)` / `modelAssetPath` regardless of how the JS wrapper
itself is imported — bundle size and hosting cost are unaffected. Same "internet needed on
first load" behavior floss-rush's own README already documents.

## Stage 2 — Build the shared `lib/tracking/` layer (6 files, no game depends on it yet) ✅ DONE

New shared layer, closest in spirit to `components/inputs/` (dumb/reusable pieces used by
*some* games, not a platform-wide concern like the multi-user room system).

- [x] **`lib/tracking/usePoseTracking.ts`** — the core hook. Combines what floss-rush's
      `startCamera()` + `loadModel()` + `loop()` do together: `getUserMedia` (ideal
      1280x720@60fps, classified errors — `NotAllowedError`/`NotFoundError`/generic, same
      as floss-rush), `FilesetResolver` + `PoseLandmarker.createFromOptions` model load, and
      an rAF loop that calls `detectForVideo` only on new video frames (dedupe via
      `video.currentTime`, exactly as floss-rush does). Exposes `videoRef`, `canvasRef`,
      latest landmarks via an **`onResult` callback ref, not React state** (avoid 60fps
      re-renders — non-negotiable perf detail), and a `status: "loading" | "ready" | "error"`
      union with an error message.
  - [x] **Cleans up on unmount**: cancels the rAF loop, stops every `MediaStreamTrack`
        (`stream.getTracks().forEach(t => t.stop())`), and calls `landmarker.close()` to
        release WASM/GPU memory.
- [x] **`lib/tracking/signals.ts`** — `MovingAverage` class (ported verbatim, already
      generic) and `isVisible(landmarks, requiredIndices, threshold)` — a generalization of
      floss-rush's hardcoded 6-landmark-index visibility check, parametrized so a future
      game (different key joints) can reuse it.
- [x] **`lib/tracking/drawPose.ts`** — plain functions, not hidden inside the hook since
      skeleton visibility/color varies per game: `drawMirroredVideoFrame` + `drawSkeleton`
      (ported from `drawFrame`/`drawSkeleton`).
- [x] **`lib/tracking/useCountdown.ts`** — generic, cancelable N→0→"GO" countdown hook
      (ported from `startCountdown`'s setTimeout chain). Takes `from`/`tickMs`/`goMs` as
      arguments — floss-rush's specific `900ms`/`600ms`/`COUNTDOWN_FROM: 3` values stay in
      `games/floss-rush/config.ts`, passed in, not hardcoded as defaults here.
- [x] **`lib/tracking/CameraCheck.tsx`** — shared "step back, hold still, Ready" gating
      screen (status text + Back/Ready buttons, styled to Roomful's dark/accent
      conventions). Owns the stability-timer logic internally (ported from
      `updateCameraCheck`), parametrized by `isVisible: boolean` and `stabilityMs: number`
      (floss-rush passes its own `READY_STABILITY_MS: 1000`, not a shared default).
- [x] **`lib/tracking/types.ts`** — thin `Landmark`/`PoseResult` aliases over
      `@mediapipe/tasks-vision`'s own `NormalizedLandmark`/`PoseLandmarkerResult`, so game
      code doesn't import mediapipe types directly everywhere.
- [x] Verify: `npx tsc --noEmit` and `npm run lint` pass. No visible UI yet at this stage
      (nothing imports the new layer), confirmed by a clean `npm run build` showing the same
      route list as before — no browser check possible until Stage 3.

Two lint fixes needed along the way (this repo's `eslint-config-next` includes the newer
`react-hooks` rules): (1) `react-hooks/refs` disallows writing a ref's `.current` directly
during render (the common "latest callback ref" pattern) — moved those assignments into a
`useEffect`. (2) `react-hooks/set-state-in-effect` disallows calling `setState` synchronously
in an effect body (to avoid a cascading extra render) — in `CameraCheck.tsx`, wrapped the
`setStable` calls in `setTimeout(..., 0)`/the real stability delay, and additionally gated
the Ready button on `isVisible && stable` together so the deferred reset can never leave a
one-tick window where a stale `stable=true` enables Ready.

## Stage 3 — Build `games/floss-rush/` and wire it into the registries

- [ ] **`games/floss-rush/meta.ts`** — `GameMeta` with `mode: "single-device"`,
      `accent: "#50dcff"` (floss-rush's own `--accent`), `minPlayers: 1, maxPlayers: 1`
      (one person is tracked at a time; note this doesn't actually affect the homepage
      card — `GameGrid.tsx` shows "Any crowd size" for all single-device games regardless
      of these numbers, so this is semantically accurate metadata, not a card-visible
      decision).
- [ ] **`games/floss-rush/config.ts`** — floss's own tunables, ported from `config.js`
      (detection thresholds + `GAME_DURATION_MS`/`COUNTDOWN_FROM`/`READY_STABILITY_MS`).
- [ ] **`games/floss-rush/detector.ts`** — `FlossDetector` class, ported ~1:1 from
      `detector.js`, typed, built on `lib/tracking/signals.ts`'s `MovingAverage`/
      `isVisible`.
- [ ] **`games/floss-rush/leaderboard.ts`** — localStorage-backed `submitScore`/
      `getTopScores`, ported ~1:1 from `leaderboard.js`. Stays game-scoped, not promoted to
      `lib/` — no other Roomful game has a "personal best" concept, and Roomful's rooms are
      otherwise ephemeral by design; this is an intentional per-game exception, same as in
      the original repo.
- [ ] **`games/floss-rush/Play.tsx`** — the state machine
      (`IDLE → CAMERA_CHECK → COUNTDOWN → PLAYING → RESULTS`, ported from `app.js`'s
      `state`), HUD (timer/score/points-flash/form-indicator, styled via Tailwind matching
      floss-rush's CSS), results screen + leaderboard list. Built on `usePoseTracking` +
      `CameraCheck` + `useCountdown`, wrapped in `PresenterLayout`/`ControlBar` for the Exit
      affordance (floss-rush's own ✕ button covers mid-run exit; Roomful's `ControlBar`
      gives a consistent Exit on the idle/start screen too, which floss-rush's standalone
      version didn't need since it had nowhere else to go).
- [ ] **`games/registry.ts`** — import `flossRushMeta`, add to the `games` array.
- [ ] **`games/clientRegistry.tsx`** — add
      `"floss-rush": { Play: dynamic(() => import("./floss-rush/Play"), { ssr: false }) }`.
      **`ssr: false` is required here specifically** (Gibberish doesn't need it) —
      `usePoseTracking` touches `navigator.mediaDevices`/camera APIs that don't exist during
      server-side rendering.
- [ ] Nothing else changes — `app/play/[gameId]/page.tsx` and the homepage `GameGrid` are
      already fully generic off these two registries.

## Stage 4 — Verification and docs

- [ ] `npx tsc --noEmit` and `npm run lint` pass across the whole change.
- [ ] Non-camera-dependent browser checks: homepage card renders under "Big screen only,"
      `/play/floss-rush` route loads without crashing, idle screen renders with a
      disabled/loading Start button before the camera+model promise resolves, and — the
      important one — navigating away (Exit) doesn't leave console errors from a dangling
      rAF loop or stream.
- [ ] **Manual camera verification** (cannot be automated — no real webcam / permission
      prompt in the dev browser tooling used for this project). Test in a real browser,
      mirroring floss-rush's own README "What to test" checklist:
  - Permission denied / no camera → friendly message on the start screen.
  - Camera-check Ready button gates on ~1s continuous tracking and re-disables the moment
    tracking drops.
  - Exit cleanly aborts from camera-check / countdown / mid-game — no leftover HUD, no
    score/best saved.
  - "Play again" re-routes through camera-check (player may have moved).
  - A slow, exaggerated *wide* floss scores more per swing than fast tiny ones.
  - Plain arm-waving (no hip counter-motion) does **not** score.
  - Final score persists as personal best; submitting adds to the leaderboard and
    highlights the just-submitted entry.
- [ ] Add a short new section to `docs/ADDING_A_GAME.md` ("Camera/pose-tracking games")
      describing `lib/tracking/`'s hooks/components and pointing at `games/floss-rush/` as
      the reference — mirrors how the doc already explains simultaneous-vs-sequential for
      multi-user games. No existing section covers this today.

## Reference files (existing Roomful conventions to match)

- `games/gibberish/Play.tsx` — the reference single-device game shape (local `useState`
  stage machine, `PresenterLayout`/`ControlBar`/`BarButton`).
- `components/PresenterLayout.tsx` — `PresenterLayout({accent, children, corner})`,
  `ControlBar({children})`, `BarButton({onClick, children, primary})`.
- `lib/types.ts` — `GameMeta` shape.
- `games/registry.ts` / `games/clientRegistry.tsx` — exact registration pattern.
- `docs/ADDING_A_GAME.md` — existing contributor guide, to be extended in Stage 4.

"use client";
/**
 * Reflex Runner — single-device camera game.
 *
 * State machine: IDLE -> CAMERA_CHECK -> COUNTDOWN -> PLAYING -> RESULTS.
 * Structurally mirrors games/flappy-human/Play.tsx (see that file for the
 * fuller rationale comments on the rAF/camera-fps decoupling pattern below).
 *
 * One addition flappy-human doesn't need: RunnerDetector requires an
 * explicit calibrate() call once, at the exact moment the player is
 * confirmed ready (CAMERA_CHECK -> COUNTDOWN), so every lane/duck/jump
 * signal is measured relative to THIS player's neutral stance. That call
 * happens in startCountdown(), using whatever landmarks were most recently
 * seen (lastLandmarksRef, which handleResult already keeps current for the
 * isNewSample check below). detector.reset() (which clears that baseline)
 * therefore must NOT run again between calibrate() and the start of
 * PLAYING — it only runs when (re)entering CAMERA_CHECK, never in
 * resetGameState, or a freshly calibrated baseline would be wiped moments
 * before it's used.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { usePoseTracking } from "@/lib/tracking/usePoseTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame } from "@/lib/tracking/drawPose";
import type { PoseResult, Landmark } from "@/lib/tracking/types";
import { reflexRunnerMeta } from "./meta";
import { CONFIG } from "./config";
import { RunnerDetector, isBodyVisible } from "./detector";
import { initState, step, type RunnerInput } from "./physics";
import { drawScene, drawLaneGuides } from "./draw";
import { unlockAudio, playJumpSound, playScoreSound, playCrashSound } from "./sound";
import { getBest, setBest, getTopScores, submitScore, type LeaderboardEntry } from "./leaderboard";

type Stage = "IDLE" | "CAMERA_CHECK" | "COUNTDOWN" | "PLAYING" | "RESULTS";

const MAX_DT_MS = 50; // clamp so a dropped frame / backgrounded tab can't apply a huge physics jump
const IDLE_PREVIEW = initState(); // static backdrop drawn behind the countdown number — pure/stateless, safe to reuse every frame

const DEV_TUNING = process.env.NODE_ENV !== "production";

function isSameEntry(a: LeaderboardEntry, b: LeaderboardEntry | null) {
  return !!b && a.name === b.name && a.score === b.score && a.created_at === b.created_at;
}

function getCanvasCtx(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } | null {
  const canvas = canvasRef.current;
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { ctx, canvas };
}

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IDLE");

  const [best, setBestDisplay] = useState(() => getBest());
  const [isVisible, setIsVisible] = useState(false);

  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastSubmitted, setLastSubmitted] = useState<LeaderboardEntry | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const detectorRef = useRef<RunnerDetector | null>(null);
  if (detectorRef.current === null) detectorRef.current = new RunnerDetector();

  const gameStateRef = useRef(initState());
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameTimeRef = useRef(0);
  const endingRef = useRef(false);
  const cameraCheckStableSinceRef = useRef<number | null>(null);
  const countdownStartRef = useRef(0);
  const handleResultRef = useRef<(result: PoseResult | null) => void>(() => {});
  const lastLandmarksRef = useRef<Landmark[] | undefined>(undefined);
  const pendingDetectorDtRef = useRef(0);

  // Calibrated baseline captured in startCountdown(), used to draw the
  // lane-guide lines on the PIP at the exact lane-switch threshold. Only
  // meaningful once calibrate() has run, so it's null until then and reset
  // to null on every fresh CAMERA_CHECK entry (see enterCameraCheck).
  const laneGuideBaselineRef = useRef<{ x: number; width: number } | null>(null);

  // Latest committed lane/ducking hold state, carried across the (common)
  // animation frames where the camera hasn't produced a new sample yet — see
  // the isNewSample comment below. `jumped` is intentionally NOT cached here:
  // it's a one-frame event, only ever true on the exact update() call that
  // fired it.
  const lastLaneRef = useRef<0 | 1 | 2>(1);
  const lastDuckingRef = useRef(false);

  // Dev-only keyboard input, so physics/difficulty can be tuned without a
  // camera or standing up for every iteration. Never affects a production
  // build. Left/Right set the target lane directly; Down holds duck; Up or
  // Space pulses one jump. ORed with real camera detection, not a full
  // replacement, so this stays useful even mid-camera-session.
  const devLaneRef = useRef<0 | 1 | 2>(1);
  const devDuckingRef = useRef(false);
  const devJumpPulseRef = useRef(false);

  useEffect(() => {
    if (!DEV_TUNING) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") devLaneRef.current = Math.max(0, devLaneRef.current - 1) as 0 | 1 | 2;
      else if (e.key === "ArrowRight") devLaneRef.current = Math.min(2, devLaneRef.current + 1) as 0 | 1 | 2;
      else if (e.key === "ArrowDown") devDuckingRef.current = true;
      else if (e.key === "ArrowUp" || e.key === " ") devJumpPulseRef.current = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "ArrowDown") devDuckingRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const { videoRef, canvasRef, status, errorMessage } = usePoseTracking({
    onResult: (result) => handleResultRef.current(result),
  });

  useEffect(() => {
    function resize() {
      const canvas = mainCanvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const endGame = useCallback(async (finalScoreValue: number) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setStage("RESULTS");
    setFinalScore(finalScoreValue);

    const prevBest = getBest();
    const isBestRun = finalScoreValue > prevBest;
    if (isBestRun) setBest(finalScoreValue);
    setIsNewBest(isBestRun);
    setBestDisplay(getBest());

    setSubmitted(false);
    setNameValue("");
    setLastSubmitted(null);

    setLeaderboard(await getTopScores(CONFIG.LEADERBOARD_SIZE));
  }, []);

  // Only resets the physics simulation — detector calibration/hysteresis
  // state is intentionally untouched here (see the file header comment).
  const resetGameState = useCallback(() => {
    gameStateRef.current = initState();
    endingRef.current = false;
  }, []);

  const beginPlay = useCallback(() => {
    resetGameState();
    lastFrameTimeRef.current = performance.now();
    lastLandmarksRef.current = undefined;
    pendingDetectorDtRef.current = 0;
    lastLaneRef.current = 1;
    lastDuckingRef.current = false;
    setStage("PLAYING");
  }, [resetGameState]);

  const countdown = useCountdown({
    from: CONFIG.COUNTDOWN_FROM,
    tickMs: CONFIG.COUNTDOWN_TICK_MS,
    goMs: CONFIG.COUNTDOWN_GO_MS,
    onDone: beginPlay,
  });

  const startCountdownTimer = countdown.start;
  const startCountdown = useCallback(() => {
    // Calibrate against whatever landmarks were most recently seen — the
    // player has just held a stable stance for READY_STABILITY_MS, so this
    // is their neutral baseline for the whole run.
    laneGuideBaselineRef.current = detectorRef.current!.calibrate(lastLandmarksRef.current ?? null);
    countdownStartRef.current = performance.now();
    setStage("COUNTDOWN");
    startCountdownTimer();
  }, [startCountdownTimer]);

  const handleResult = useCallback(
    (result: PoseResult | null) => {
      const video = videoRef.current;
      const landmarks = result?.landmarks?.[0];

      const isNewSample = landmarks !== lastLandmarksRef.current;
      lastLandmarksRef.current = landmarks;

      const pip = getCanvasCtx(canvasRef);
      if (pip && video && video.readyState >= 2 && isNewSample) {
        drawMirroredVideoFrame(pip.ctx, video, pip.canvas);
        if (laneGuideBaselineRef.current) {
          drawLaneGuides(pip.ctx, pip.canvas, laneGuideBaselineRef.current);
        }
      }

      if (stage === "CAMERA_CHECK") {
        const visible = isBodyVisible(landmarks);
        setIsVisible(visible);
        if (!visible) {
          cameraCheckStableSinceRef.current = null;
        } else if (cameraCheckStableSinceRef.current === null) {
          cameraCheckStableSinceRef.current = performance.now();
        } else if (performance.now() - cameraCheckStableSinceRef.current >= CONFIG.READY_STABILITY_MS) {
          cameraCheckStableSinceRef.current = null;
          startCountdown();
        }
        return;
      }

      if (stage === "COUNTDOWN") {
        const main = getCanvasCtx(mainCanvasRef);
        if (main) {
          drawScene(main.ctx, main.canvas.width, main.canvas.height, IDLE_PREVIEW);
        }
        return;
      }

      if (stage !== "PLAYING") return;

      const now = performance.now();
      const dtMs = Math.min(MAX_DT_MS, now - lastFrameTimeRef.current);
      lastFrameTimeRef.current = now;

      // Physics/rendering advance every animation frame regardless (smooth
      // motion even if the camera is slower than the display), but the
      // detector only advances on a genuinely new camera sample — see
      // flappy-human/Play.tsx's handleResult for the full rationale.
      pendingDetectorDtRef.current += dtMs;

      let jumped = false;
      if (isNewSample) {
        const det = detectorRef.current!.update(landmarks, pendingDetectorDtRef.current);
        pendingDetectorDtRef.current = 0;
        setIsVisible(det.visible);
        lastLaneRef.current = det.lane;
        lastDuckingRef.current = det.ducking;
        jumped = det.jumped;
      }

      let input: RunnerInput = { lane: lastLaneRef.current, ducking: lastDuckingRef.current, jumped };
      if (DEV_TUNING) {
        input = {
          lane: devLaneRef.current,
          ducking: devDuckingRef.current || input.ducking,
          jumped: devJumpPulseRef.current || input.jumped,
        };
        devJumpPulseRef.current = false;
      }

      const prev = gameStateRef.current;
      const next = step(prev, dtMs, input);
      gameStateRef.current = next;

      const wasAlive = prev.status !== "dead";
      if (wasAlive && input.jumped) playJumpSound();
      if (next.score > prev.score) playScoreSound();
      if (wasAlive && next.status === "dead") {
        playCrashSound();
        void endGame(next.score);
      }

      const main = getCanvasCtx(mainCanvasRef);
      if (main) {
        drawScene(main.ctx, main.canvas.width, main.canvas.height, next);
      }
    },
    [stage, endGame, videoRef, canvasRef, startCountdown]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  function enterCameraCheck() {
    cameraCheckStableSinceRef.current = null;
    // Fresh calibration cycle starting — clear the previous run's baseline
    // and lane/duck/jump hysteresis state. calibrate() re-establishes the
    // baseline once the player is confirmed ready again (in startCountdown).
    detectorRef.current!.reset();
    laneGuideBaselineRef.current = null;
    setStage("CAMERA_CHECK");
  }

  function handleStartClick() {
    unlockAudio();
    enterCameraCheck();
  }

  function exitToIdle() {
    countdown.cancel();
    resetGameState();
    cameraCheckStableSinceRef.current = null;
    setIsVisible(false);
    setStage("IDLE");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entry = await submitScore({ name: nameValue, score: finalScore });
    setLastSubmitted(entry);
    setSubmitted(true);
    setLeaderboard(await getTopScores(CONFIG.LEADERBOARD_SIZE));
  }

  const showCameraChrome = stage === "CAMERA_CHECK" || stage === "COUNTDOWN" || stage === "PLAYING";

  return (
    <PresenterLayout accent={reflexRunnerMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={mainCanvasRef} className="fixed inset-0 -z-10 h-full w-full bg-black" />
      <canvas
        ref={canvasRef}
        className="fixed bottom-5 right-5 z-10 rounded-lg border-2 border-white/40 shadow-lg"
        style={{ width: CONFIG.CAMERA_PIP_WIDTH, height: CONFIG.CAMERA_PIP_HEIGHT }}
      />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Reflex <span className="text-[var(--accent)]">Runner</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-700">
            Lean to change lanes, jump the hurdles, duck the bars. Starts gentle, gets brutal fast.
          </p>
          <p className="text-sm text-zinc-500">Your best: {best}</p>
          {status === "error" && <p className="max-w-md font-semibold text-pink-600">{errorMessage}</p>}
          <button
            onClick={handleStartClick}
            disabled={status !== "ready"}
            className="rounded-full bg-[var(--accent)] px-10 py-4 text-xl font-bold text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "loading" ? "Loading…" : status === "error" ? "Unavailable" : "Start"}
          </button>
        </div>
      )}

      {stage === "CAMERA_CHECK" && (
        <div className="rounded-2xl bg-[var(--background)]/95 p-10 shadow-lg backdrop-blur-sm">
          <CameraCheck
            isVisible={isVisible}
            stabilityMs={CONFIG.READY_STABILITY_MS}
            onReady={startCountdown}
            onBack={exitToIdle}
          />
        </div>
      )}

      {stage === "COUNTDOWN" && (
        <p className="text-[14rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
          {countdown.label}
        </p>
      )}

      {stage === "PLAYING" && !isVisible && (
        <div className="pointer-events-none fixed inset-0">
          <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/85 px-6 py-3 text-lg font-bold text-white">
            Get back in frame!
          </p>
        </div>
      )}

      {stage === "RESULTS" && (
        <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <div>
            <p className="text-8xl font-black leading-none tabular-nums text-[var(--accent)]">{finalScore}</p>
            <p className="text-sm tracking-[0.3em] text-zinc-500">FINAL SCORE</p>
          </div>
          {isNewBest && <p className="text-xl font-extrabold text-pink-600">New best!</p>}

          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                maxLength={CONFIG.NAME_MAX_LEN}
                placeholder="Your name"
                className="rounded-full border-2 border-zinc-300 bg-white px-5 py-3 text-lg text-zinc-900 outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                className="rounded-full bg-[var(--accent)] px-6 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
              >
                Save
              </button>
            </form>
          ) : (
            <p className="font-bold text-emerald-600">Saved!</p>
          )}

          <ul className="flex w-full max-w-md flex-col gap-1">
            {leaderboard.length === 0 && <li className="py-4 text-zinc-500">No scores yet — be the first!</li>}
            {leaderboard.map((entry, i) => (
              <li
                key={`${entry.name}-${entry.created_at}`}
                className={
                  "grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg px-4 py-2 text-left " +
                  (isSameEntry(entry, lastSubmitted) ? "bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]" : "bg-zinc-100")
                }
              >
                <span className="font-extrabold text-zinc-500">{i + 1}</span>
                <span className="truncate">{entry.name}</span>
                <span className="font-extrabold tabular-nums text-[var(--accent)]">{entry.score}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={enterCameraCheck}
            className="rounded-full bg-[var(--accent)] px-8 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
          >
            Play again
          </button>
        </div>
      )}

      {showCameraChrome && (
        <button
          onClick={exitToIdle}
          aria-label="Exit to start screen"
          className="fixed right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-950/60 text-lg text-white"
        >
          ✕
        </button>
      )}

      {(stage === "IDLE" || stage === "RESULTS") && (
        <ControlBar>
          <BarButton onClick={() => router.push("/")}>Exit</BarButton>
        </ControlBar>
      )}
    </PresenterLayout>
  );
}

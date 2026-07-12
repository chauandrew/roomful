"use client";
/**
 * Chomp Chomp — single-device camera game.
 *
 * State machine:
 *   IDLE -> CAMERA_CHECK -> CALIBRATE_OPEN -> CALIBRATE_CLOSE -> COUNTDOWN
 *   -> PLAYING -> RESULTS, with a CALIBRATION_FAILED detour back to
 *   CALIBRATE_OPEN if the calibration range comes out too small.
 *
 * Camera + model load starts immediately on mount (via useFaceTracking) so
 * they're usually ready by the time the host clicks Start.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { useFaceTracking } from "@/lib/tracking/useFaceTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame } from "@/lib/tracking/drawPose";
import { MovingAverage, mouthOpenRatio } from "@/lib/tracking/signals";
import type { FaceResult } from "@/lib/tracking/types";
import { chompChompMeta } from "./meta";
import { CONFIG } from "./config";
import { NOSE_TIP, isFaceVisible, generateDots, computeOpenThreshold, wedgeHalfAngleRad, tryEatDots } from "./logic";
import { drawDots, drawWedge } from "./draw";
import { unlockAudio, playChompSound, playMouthOpenSound, playMouthCloseSound } from "./sound";
import type { Dot } from "./logic";

type Stage =
  | "IDLE"
  | "CAMERA_CHECK"
  | "CALIBRATE_OPEN"
  | "CALIBRATE_CLOSE"
  | "CALIBRATION_FAILED"
  | "COUNTDOWN"
  | "PLAYING"
  | "RESULTS";

const TOTAL_DOTS = CONFIG.DOT_GRID_COLS * CONFIG.DOT_GRID_ROWS;

function getBest(): number {
  if (typeof sessionStorage === "undefined") return 0;
  return Number(sessionStorage.getItem(CONFIG.BEST_SCORE_KEY) || 0);
}

function setBest(v: number) {
  sessionStorage.setItem(CONFIG.BEST_SCORE_KEY, String(v));
}

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IDLE");

  const [best, setBestDisplay] = useState(() => getBest());
  const [isVisible, setIsVisible] = useState(false);
  const [faceLost, setFaceLost] = useState(false);
  const [timerText, setTimerText] = useState((CONFIG.ROUND_DURATION_MS / 1000).toFixed(1));
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [finishedEarly, setFinishedEarly] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const mouthMARef = useRef<MovingAverage | null>(null);
  if (mouthMARef.current === null) mouthMARef.current = new MovingAverage(CONFIG.MOUTH_SMOOTHING_WINDOW);

  const currentMouthRatioRef = useRef(0);
  const faceVisibleRef = useRef(false);
  const faceCursorRef = useRef<{ x: number; y: number } | null>(null);

  const minRatioRef = useRef(0);
  const maxRatioRef = useRef(0);
  const openThresholdRef = useRef<number | null>(null);

  const dotsRef = useRef<Dot[]>([]);
  const ateThisOpenRef = useRef(false);
  const wasMouthOpenRef = useRef(false);
  const scoreRef = useRef(0);
  const playStartRef = useRef(0);
  const endingRef = useRef(false);
  const handleResultRef = useRef<(result: FaceResult | null) => void>(() => {});

  // useFaceTracking needs a stable onResult reference at call time, but the
  // real handler (below) needs videoRef/canvasRef that useFaceTracking
  // itself returns. Forward through a ref to break the circularity.
  const { videoRef, canvasRef, status, errorMessage } = useFaceTracking({
    onResult: (result) => handleResultRef.current(result),
  });

  const endRound = useCallback((elapsedMs: number, early: boolean) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setStage("RESULTS");

    const value = scoreRef.current;
    setFinalScore(value);
    setFinishedEarly(early);
    setElapsedSeconds(elapsedMs / 1000);

    const prevBest = getBest();
    const isBestRun = value > prevBest;
    if (isBestRun) setBest(value);
    setIsNewBest(isBestRun);
    setBestDisplay(getBest());
  }, []);

  const handleResult = useCallback(
    (result: FaceResult | null) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const landmarks = result?.faceLandmarks?.[0];

      const visible = isFaceVisible(landmarks);
      faceVisibleRef.current = visible;

      // Un-mirror the face-cursor x here (canvas.width - x) so it lands in
      // the same mirrored space the video is drawn in, without needing an
      // extra canvas transform for the wedge/dots. Frozen (not updated) when
      // the face is lost, per spec, rather than snapping to a stale 0,0.
      if (landmarks && canvas) {
        const rawRatio = mouthOpenRatio(landmarks);
        currentMouthRatioRef.current = mouthMARef.current!.push(rawRatio);
        const nose = landmarks[NOSE_TIP];
        faceCursorRef.current = { x: canvas.width - nose.x * canvas.width, y: nose.y * canvas.height };
      }

      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMirroredVideoFrame(ctx, video, canvas);

      if (stage === "CAMERA_CHECK") {
        setIsVisible(visible);
        return;
      }

      if (stage === "PLAYING") {
        const elapsed = performance.now() - playStartRef.current;
        const remaining = Math.max(0, CONFIG.ROUND_DURATION_MS - elapsed);
        setTimerText((remaining / 1000).toFixed(1));
        setFaceLost(!visible);

        const cursor = faceCursorRef.current;
        const threshold = openThresholdRef.current;
        if (cursor && threshold !== null) {
          const mouthOpen = currentMouthRatioRef.current >= threshold;
          if (mouthOpen !== wasMouthOpenRef.current) {
            wasMouthOpenRef.current = mouthOpen;
            if (mouthOpen) playMouthOpenSound();
            else playMouthCloseSound();
          }
          if (!mouthOpen) ateThisOpenRef.current = false;
          const eaten = tryEatDots(dotsRef.current, cursor, mouthOpen, !ateThisOpenRef.current);
          if (eaten > 0) {
            ateThisOpenRef.current = true;
            scoreRef.current += eaten;
            setScore(scoreRef.current);
            playChompSound();
          }

          const halfAngle = wedgeHalfAngleRad(currentMouthRatioRef.current, minRatioRef.current, maxRatioRef.current);
          drawDots(ctx, dotsRef.current);
          drawWedge(ctx, cursor, halfAngle);
        }

        if (scoreRef.current >= TOTAL_DOTS) endRound(elapsed, true);
        else if (remaining <= 0) endRound(CONFIG.ROUND_DURATION_MS, false);
      }
    },
    [stage, endRound, videoRef, canvasRef]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  const beginPlay = useCallback(() => {
    const canvas = canvasRef.current;
    dotsRef.current = canvas ? generateDots(canvas.width, canvas.height) : [];
    scoreRef.current = 0;
    ateThisOpenRef.current = false;
    wasMouthOpenRef.current = false;
    setScore(0);
    setFaceLost(false);
    setTimerText((CONFIG.ROUND_DURATION_MS / 1000).toFixed(1));
    endingRef.current = false;
    playStartRef.current = performance.now();
    setStage("PLAYING");
  }, [canvasRef]);

  const countdown = useCountdown({
    from: CONFIG.COUNTDOWN_FROM,
    tickMs: CONFIG.COUNTDOWN_TICK_MS,
    goMs: CONFIG.COUNTDOWN_GO_MS,
    onDone: beginPlay,
  });
  const { start: startCountdown } = countdown;

  // Drives the two calibration steps: wait CALIBRATION_HOLD_MS, then capture
  // whatever the (smoothed) mouth ratio is and advance. Starts the 3-2-1
  // countdown itself, synchronously with the CALIBRATE_CLOSE -> COUNTDOWN
  // transition, rather than via a separate stage-watching effect — the
  // `countdown` object useCountdown returns is a new reference every render
  // (its tick-driven re-renders included), so watching it as a dependency
  // would re-fire and restart the countdown mid-count.
  useEffect(() => {
    if (stage !== "CALIBRATE_OPEN" && stage !== "CALIBRATE_CLOSE") return;
    const timeout = setTimeout(() => {
      if (!faceVisibleRef.current) {
        setStage("CALIBRATION_FAILED");
        return;
      }
      if (stage === "CALIBRATE_OPEN") {
        maxRatioRef.current = currentMouthRatioRef.current;
        setStage("CALIBRATE_CLOSE");
      } else {
        minRatioRef.current = currentMouthRatioRef.current;
        const threshold = computeOpenThreshold(minRatioRef.current, maxRatioRef.current);
        if (threshold === null) {
          setStage("CALIBRATION_FAILED");
        } else {
          openThresholdRef.current = threshold;
          setStage("COUNTDOWN");
          startCountdown();
        }
      }
    }, CONFIG.CALIBRATION_HOLD_MS);
    return () => clearTimeout(timeout);
  }, [stage, startCountdown]);

  function enterCameraCheck() {
    unlockAudio();
    setStage("CAMERA_CHECK");
  }

  function startCalibration() {
    mouthMARef.current!.reset();
    setStage("CALIBRATE_OPEN");
  }

  // Aborts the current run back to idle. The in-progress score is discarded.
  function exitToIdle() {
    countdown.cancel();
    scoreRef.current = 0;
    setScore(0);
    setFaceLost(false);
    setStage("IDLE");
  }

  return (
    <PresenterLayout accent={chompChompMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="fixed inset-0 -z-10 h-full w-full bg-black object-cover" />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Chomp <span className="text-[var(--accent)]">Chomp</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-700">
            A wedge follows your face and opens with your real mouth. Chomp all 25 dots in 20 seconds.
          </p>
          <p className="text-sm text-zinc-500">Your best: {best}</p>
          {status === "error" && <p className="max-w-md font-semibold text-pink-600">{errorMessage}</p>}
          <button
            onClick={enterCameraCheck}
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
            notVisibleLabel="Step back — get your whole face in frame"
            visibleLabel="Face detected"
            onReady={startCalibration}
            onBack={exitToIdle}
          />
        </div>
      )}

      {(stage === "CALIBRATE_OPEN" || stage === "CALIBRATE_CLOSE") && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <p className="text-4xl font-bold text-[var(--accent)]">
            {stage === "CALIBRATE_OPEN" ? "Open your mouth as wide as you can" : "Now close your mouth"}
          </p>
          <p className="text-lg text-zinc-500">Hold it…</p>
        </div>
      )}

      {stage === "CALIBRATION_FAILED" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <p className="max-w-md text-2xl font-bold text-pink-600">
            Couldn&apos;t get a clear read on your mouth. Make sure your face is well-lit and fully in frame.
          </p>
          <div className="flex gap-4">
            <button
              onClick={exitToIdle}
              className="rounded-md bg-zinc-200 px-6 py-3 text-lg font-medium text-zinc-700 hover:bg-zinc-300"
            >
              Back
            </button>
            <button
              onClick={startCalibration}
              className="rounded-md bg-[var(--accent)] px-6 py-3 text-lg font-medium text-zinc-950 hover:brightness-110"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {stage === "COUNTDOWN" && (
        <p className="text-[14rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
          {countdown.label}
        </p>
      )}

      {stage === "PLAYING" && (
        <div className="pointer-events-none fixed inset-0">
          <p className="absolute left-1/2 top-6 -translate-x-1/2 text-6xl font-extrabold tabular-nums text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
            {timerText}
          </p>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
            <p className="text-[8rem] font-black leading-[0.9] tabular-nums text-[var(--accent)] drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
              {score} / {TOTAL_DOTS}
            </p>
            <p className="text-lg tracking-[0.3em] text-zinc-300">DOTS EATEN</p>
          </div>

          {faceLost && (
            <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/85 px-6 py-3 text-lg font-bold text-white">
              Face not detected — get back in frame!
            </p>
          )}
        </div>
      )}

      {stage === "RESULTS" && (
        <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <div>
            <p className="text-8xl font-black leading-none tabular-nums text-[var(--accent)]">{finalScore}</p>
            <p className="text-sm tracking-[0.3em] text-zinc-500">
              You ate {finalScore} / {TOTAL_DOTS} dots!
            </p>
          </div>
          {finishedEarly && (
            <p className="text-xl font-extrabold text-[var(--accent)]">
              Finished in {elapsedSeconds.toFixed(1)}s!
            </p>
          )}
          {isNewBest && <p className="text-xl font-extrabold text-pink-600">New best!</p>}
          <p className="text-sm text-zinc-500">Best this session: {best}</p>

          <button
            onClick={enterCameraCheck}
            className="rounded-full bg-[var(--accent)] px-8 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
          >
            Play again
          </button>
        </div>
      )}

      {(stage === "CAMERA_CHECK" ||
        stage === "CALIBRATE_OPEN" ||
        stage === "CALIBRATE_CLOSE" ||
        stage === "CALIBRATION_FAILED" ||
        stage === "COUNTDOWN" ||
        stage === "PLAYING") && (
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

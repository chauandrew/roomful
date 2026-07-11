"use client";
/**
 * Floss Rush — single-device camera game.
 *
 * State machine: IDLE -> CAMERA_CHECK -> COUNTDOWN -> PLAYING -> RESULTS.
 * Camera + model load starts immediately on mount (via usePoseTracking) so
 * they're usually ready by the time the host clicks Start.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { usePoseTracking } from "@/lib/tracking/usePoseTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame, drawSkeleton } from "@/lib/tracking/drawPose";
import type { PoseResult } from "@/lib/tracking/types";
import { flossRushMeta } from "./meta";
import { CONFIG } from "./config";
import { FlossDetector, isBodyVisible } from "./detector";
import { getBest, setBest, getTopScores, submitScore, type LeaderboardEntry } from "./leaderboard";

type Stage = "IDLE" | "CAMERA_CHECK" | "COUNTDOWN" | "PLAYING" | "RESULTS";

function isSameEntry(a: LeaderboardEntry, b: LeaderboardEntry | null) {
  return !!b && a.name === b.name && a.score === b.score && a.created_at === b.created_at;
}

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IDLE");

  const [best, setBestDisplay] = useState(() => getBest());

  const [timerText, setTimerText] = useState((CONFIG.GAME_DURATION_MS / 1000).toFixed(1));
  const [timerUrgent, setTimerUrgent] = useState(false);
  const [score, setScore] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const [pointsFlash, setPointsFlash] = useState<{ points: number; id: number } | null>(null);
  const [formFlashId, setFormFlashId] = useState<number | null>(null);

  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastSubmitted, setLastSubmitted] = useState<LeaderboardEntry | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const detectorRef = useRef<FlossDetector | null>(null);
  if (detectorRef.current === null) detectorRef.current = new FlossDetector();
  const scoreRef = useRef(0);
  const playStartRef = useRef(0);
  const endingRef = useRef(false);
  const flashCounterRef = useRef(0);
  const handleResultRef = useRef<(result: PoseResult | null) => void>(() => {});

  useEffect(() => {
    if (!pointsFlash) return;
    const t = setTimeout(() => setPointsFlash(null), 700);
    return () => clearTimeout(t);
  }, [pointsFlash]);

  useEffect(() => {
    if (formFlashId === null) return;
    const t = setTimeout(() => setFormFlashId(null), 800);
    return () => clearTimeout(t);
  }, [formFlashId]);

  // usePoseTracking needs a stable onResult reference at call time, but the
  // real handler (below) needs videoRef/canvasRef that usePoseTracking
  // itself returns. Forward through a ref to break the circularity.
  const { videoRef, canvasRef, status, errorMessage } = usePoseTracking({
    onResult: (result) => handleResultRef.current(result),
  });

  const addPoints = useCallback((points: number, goodForm: boolean) => {
    scoreRef.current += points;
    setScore(scoreRef.current);
    flashCounterRef.current += 1;
    setPointsFlash({ points, id: flashCounterRef.current });
    if (goodForm) setFormFlashId(flashCounterRef.current);
  }, []);

  const endGame = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setStage("RESULTS");

    const value = scoreRef.current;
    setFinalScore(value);

    const prevBest = getBest();
    const isBestRun = value > prevBest;
    if (isBestRun) setBest(value);
    setIsNewBest(isBestRun);
    setBestDisplay(getBest());

    setSubmitted(false);
    setNameValue("");
    setLastSubmitted(null);

    setLeaderboard(await getTopScores(CONFIG.LEADERBOARD_SIZE));
  }, []);

  const handleResult = useCallback(
    (result: PoseResult | null) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const landmarks = result?.landmarks?.[0];

      if (canvas && video && video.readyState >= 2) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawMirroredVideoFrame(ctx, video, canvas);
          if (CONFIG.SHOW_SKELETON && landmarks) drawSkeleton(ctx, canvas, landmarks);
        }
      }

      if (stage === "PLAYING") {
        const remaining = Math.max(0, CONFIG.GAME_DURATION_MS - (performance.now() - playStartRef.current));
        setTimerText((remaining / 1000).toFixed(1));
        setTimerUrgent(remaining <= 5000);

        const ev = detectorRef.current!.update(landmarks);
        setIsVisible(ev.visible);
        if (ev.swing) addPoints(ev.swing.points, ev.swing.goodForm);
        if (remaining <= 0) void endGame();
      } else if (stage === "CAMERA_CHECK") {
        setIsVisible(isBodyVisible(landmarks));
      }
    },
    [stage, addPoints, endGame, videoRef, canvasRef]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  const beginPlay = useCallback(() => {
    scoreRef.current = 0;
    setScore(0);
    detectorRef.current!.reset();
    setTimerText((CONFIG.GAME_DURATION_MS / 1000).toFixed(1));
    setTimerUrgent(false);
    endingRef.current = false;
    playStartRef.current = performance.now();
    setStage("PLAYING");
  }, []);

  const countdown = useCountdown({
    from: CONFIG.COUNTDOWN_FROM,
    tickMs: CONFIG.COUNTDOWN_TICK_MS,
    goMs: CONFIG.COUNTDOWN_GO_MS,
    onDone: beginPlay,
  });

  function enterCameraCheck() {
    setStage("CAMERA_CHECK");
  }

  function startCountdown() {
    setStage("COUNTDOWN");
    countdown.start();
  }

  // Aborts the current run (camera check, countdown, or mid-game) back to
  // idle. The in-progress score is discarded: nothing submitted, best untouched.
  function exitToIdle() {
    countdown.cancel();
    scoreRef.current = 0;
    setScore(0);
    detectorRef.current!.reset();
    setTimerUrgent(false);
    setStage("IDLE");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entry = await submitScore({ name: nameValue, score: finalScore });
    setLastSubmitted(entry);
    setSubmitted(true);
    setLeaderboard(await getTopScores(CONFIG.LEADERBOARD_SIZE));
  }

  return (
    <PresenterLayout accent={flossRushMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="fixed inset-0 -z-10 h-full w-full bg-black object-cover" />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-zinc-950/80 p-10 text-center backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Floss <span className="text-[var(--accent)]">Rush</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-300">
            Step up to the camera and floss as fast and wide as you can. 15 seconds on the clock.
          </p>
          <p className="text-sm text-zinc-500">Your best: {best}</p>
          {status === "error" && <p className="max-w-md font-semibold text-pink-400">{errorMessage}</p>}
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
        <div className="rounded-2xl bg-zinc-950/70 p-10 backdrop-blur-sm">
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

      {stage === "PLAYING" && (
        <div className="pointer-events-none fixed inset-0">
          <p
            className={
              "absolute left-1/2 top-6 -translate-x-1/2 text-6xl font-extrabold tabular-nums drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)] " +
              (timerUrgent ? "animate-pulse text-pink-400" : "text-white")
            }
          >
            {timerText}
          </p>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
            <p className="text-[8rem] font-black leading-[0.9] tabular-nums text-[var(--accent)] drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
              {score}
            </p>
            <p className="text-lg tracking-[0.3em] text-zinc-300">SCORE</p>
          </div>

          {pointsFlash && (
            <p
              key={`points-${pointsFlash.id}`}
              className="absolute bottom-56 left-1/2 -translate-x-1/2 animate-bounce text-4xl font-extrabold text-emerald-400 drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
            >
              +{pointsFlash.points}
            </p>
          )}

          {formFlashId !== null && (
            <p
              key={`form-${formFlashId}`}
              className="absolute left-1/2 top-32 -translate-x-1/2 text-xl font-bold tracking-wide text-emerald-400 drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
            >
              Nice form!
            </p>
          )}

          {!isVisible && (
            <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/85 px-6 py-3 text-lg font-bold text-white">
              Get back in frame!
            </p>
          )}
        </div>
      )}

      {stage === "RESULTS" && (
        <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto rounded-2xl bg-zinc-950/80 p-10 text-center backdrop-blur-sm">
          <div>
            <p className="text-8xl font-black leading-none tabular-nums text-[var(--accent)]">{finalScore}</p>
            <p className="text-sm tracking-[0.3em] text-zinc-400">FINAL SCORE</p>
          </div>
          {isNewBest && <p className="text-xl font-extrabold text-pink-400">New best!</p>}

          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                maxLength={CONFIG.NAME_MAX_LEN}
                placeholder="Your name"
                className="rounded-full border-2 border-white/25 bg-white/10 px-5 py-3 text-lg text-white outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                className="rounded-full bg-[var(--accent)] px-6 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
              >
                Save
              </button>
            </form>
          ) : (
            <p className="font-bold text-emerald-400">Saved!</p>
          )}

          <ul className="flex w-full max-w-md flex-col gap-1">
            {leaderboard.length === 0 && <li className="py-4 text-zinc-500">No scores yet — be the first!</li>}
            {leaderboard.map((entry, i) => (
              <li
                key={`${entry.name}-${entry.created_at}`}
                className={
                  "grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg px-4 py-2 text-left " +
                  (isSameEntry(entry, lastSubmitted) ? "bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]" : "bg-white/5")
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

      {(stage === "CAMERA_CHECK" || stage === "COUNTDOWN" || stage === "PLAYING") && (
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

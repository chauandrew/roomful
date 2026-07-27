"use client";
/**
 * Flappy Human — single-device camera game.
 *
 * State machine: IDLE -> CAMERA_CHECK -> COUNTDOWN -> PLAYING -> RESULTS.
 * Camera + model load starts immediately on mount (via usePoseTracking) so
 * they're usually ready by the time the host clicks Start.
 *
 * Unlike floss-rush, the main canvas is a full-viewport game world (drawn by
 * draw.ts's drawScene, in a fixed logical grid scaled to actual pixels) —
 * not a mirrored video feed. The camera feed instead drives a small
 * corner "picture-in-picture" canvas, which reuses usePoseTracking's own
 * canvasRef (drawn via drawMirroredVideoFrame) so the room can still see the
 * player flapping.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { usePoseTracking } from "@/lib/tracking/usePoseTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame } from "@/lib/tracking/drawPose";
import type { PoseResult, Landmark } from "@/lib/tracking/types";
import { flappyHumanMeta } from "./meta";
import { CONFIG } from "./config";
import { FlapDetector, isBodyVisible } from "./detector";
import { initState, step, type Pipe } from "./physics";
import { drawScene, loadBirdSprites, type BirdSprites } from "./draw";
import {
  unlockAudio,
  playFlapSound,
  playScoreSound,
  playCrashSound,
  createBackgroundMusic,
  type BackgroundMusic,
} from "./sound";
import { getBest, setBest, getTopScores, submitScore, type LeaderboardEntry } from "./leaderboard";
import { FlapRecorder } from "./recorder";

type Stage = "IDLE" | "CAMERA_CHECK" | "COUNTDOWN" | "PLAYING" | "RESULTS";

const MAX_DT_MS = 50; // clamp so a dropped frame / backgrounded tab can't apply a huge physics jump
const EMPTY_PIPES: Pipe[] = []; // shared, reused constant — the countdown preview never has pipes, no need to allocate a fresh array every frame

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
  const [isMuted, setIsMuted] = useState(false);

  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastSubmitted, setLastSubmitted] = useState<LeaderboardEntry | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [recordingSampleCount, setRecordingSampleCount] = useState(0);

  const detectorRef = useRef<FlapDetector | null>(null);
  if (detectorRef.current === null) detectorRef.current = new FlapDetector();
  const musicRef = useRef<BackgroundMusic | null>(null);
  if (musicRef.current === null) musicRef.current = createBackgroundMusic();
  const spritesRef = useRef<BirdSprites | null>(null);
  if (spritesRef.current === null) spritesRef.current = loadBirdSprites();
  const recorderRef = useRef<FlapRecorder | null>(null);
  if (recorderRef.current === null) recorderRef.current = new FlapRecorder();

  const gameStateRef = useRef(initState());
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameTimeRef = useRef(0);
  const endingRef = useRef(false);
  // Timestamp the camera check last became continuously visible; once it's held
  // for READY_STABILITY_MS we advance automatically (see handleResult below) —
  // holding a flap-ready pose while also reaching for a mouse click is awkward,
  // so this removes the click entirely instead of just enabling a button for it.
  const cameraCheckStableSinceRef = useRef<number | null>(null);
  // Real gameplay physics only starts once PLAYING begins (no pre-flap hover
  // phase), so the gentle bob shown behind the countdown is a presentation-
  // only preview, timed off this timestamp — not a real GameState.
  const countdownStartRef = useRef(0);
  const handleResultRef = useRef<(result: PoseResult | null) => void>(() => {});
  // usePoseTracking's internal loop calls onResult on every animation frame
  // (~60Hz) but only recomputes landmarks when the camera itself produces a
  // new video frame — otherwise it resends the same result object. Real
  // webcams often run well below 60fps, so most calls here are stale
  // duplicates. The detector's velocity math needs the true elapsed time
  // since the last DIFFERENT sample, not since the last call, or a burst of
  // duplicate frames followed by one real new frame reads as an artificial
  // velocity spike (real motion divided by the ~16ms since the last call,
  // instead of the true multi-frame gap) — which is exactly what caused a
  // single physical flap to double-fire. lastLandmarksRef/pendingDetectorDtMs
  // track sample freshness and accumulate real time across skipped duplicates.
  const lastLandmarksRef = useRef<Landmark[] | undefined>(undefined);
  const pendingDetectorDtRef = useRef(0);

  // usePoseTracking needs a stable onResult reference at call time, but the
  // real handler (below) needs videoRef/canvasRef that usePoseTracking
  // itself returns. Forward through a ref to break the circularity.
  const { videoRef, canvasRef, status, errorMessage } = usePoseTracking({
    onResult: (result) => handleResultRef.current(result),
  });

  // Resize the game-world canvas to fill the viewport (it's not tied to
  // video dimensions like the PIP canvas is), keeping it crisp on resize.
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

  // Shared by beginPlay and exitToIdle — the two places that discard the
  // current run and restart the simulation/detector from scratch.
  const resetGameState = useCallback(() => {
    gameStateRef.current = initState();
    detectorRef.current!.reset();
    endingRef.current = false;
  }, []);

  const beginPlay = useCallback(() => {
    resetGameState();
    lastFrameTimeRef.current = performance.now();
    lastLandmarksRef.current = undefined;
    pendingDetectorDtRef.current = 0;
    recorderRef.current!.start();
    musicRef.current?.play();
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
    countdownStartRef.current = performance.now();
    setStage("COUNTDOWN");
    startCountdownTimer();
  }, [startCountdownTimer]);

  const handleResult = useCallback(
    (result: PoseResult | null) => {
      const video = videoRef.current;
      const landmarks = result?.landmarks?.[0];

      // Real webcams often deliver well under 60fps, and usePoseTracking's
      // loop calls onResult every animation frame regardless — resending the
      // same landmarks object when the camera hasn't produced a new frame
      // yet (see lastLandmarksRef's declaration above for the full story).
      // Redrawing the PIP or advancing the detector on those stale repeats
      // is wasted work, since neither the video pixels nor the pose data
      // have actually changed.
      const isNewSample = landmarks !== lastLandmarksRef.current;
      lastLandmarksRef.current = landmarks;

      const pip = getCanvasCtx(canvasRef);
      if (pip && video && video.readyState >= 2 && isNewSample) {
        drawMirroredVideoFrame(pip.ctx, video, pip.canvas);
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
          const t = performance.now() - countdownStartRef.current;
          const phase = (2 * Math.PI * t) / CONFIG.COUNTDOWN_BOB_PERIOD_MS;
          const bobY = CONFIG.COUNTDOWN_BOB_AMPLITUDE * Math.sin(phase);
          const bobVy =
            CONFIG.COUNTDOWN_BOB_AMPLITUDE * ((2 * Math.PI) / CONFIG.COUNTDOWN_BOB_PERIOD_MS) * Math.cos(phase);
          const preview = {
            status: "flying" as const,
            birdY: CONFIG.GAME_H / 2 + bobY,
            birdVy: bobVy,
            pipes: EMPTY_PIPES,
            score: 0,
            elapsedMs: 0,
            gapHeight: 0, // unused — preview has no pipes to draw
          };
          drawScene(main.ctx, main.canvas.width, main.canvas.height, preview, spritesRef.current!);
        }
        return;
      }

      if (stage !== "PLAYING") return;

      const now = performance.now();
      const dtMs = Math.min(MAX_DT_MS, now - lastFrameTimeRef.current);
      lastFrameTimeRef.current = now;

      // Physics/rendering advance every animation frame regardless (smooth
      // motion even if the camera is slower than the display), but the
      // detector only advances on a genuinely new camera sample. Time
      // elapsed across any skipped duplicate frames accumulates so the
      // eventual real sample gets its true elapsed time, not just the last
      // callback's ~16ms.
      pendingDetectorDtRef.current += dtMs;

      let flapped = false;
      if (isNewSample) {
        recorderRef.current!.record(landmarks, now);
        const det = detectorRef.current!.update(landmarks, pendingDetectorDtRef.current);
        pendingDetectorDtRef.current = 0;
        setIsVisible(det.visible);
        flapped = det.flapped;
      }

      const prev = gameStateRef.current;
      const next = step(prev, dtMs, flapped);
      gameStateRef.current = next;

      const wasAlive = prev.status !== "dead";
      if (wasAlive && flapped && !isMuted) playFlapSound();
      if (next.score > prev.score && !isMuted) playScoreSound();
      if (wasAlive && next.status === "dead") {
        if (!isMuted) playCrashSound();
        musicRef.current?.stop();
        recorderRef.current!.stop();
        setRecordingSampleCount(recorderRef.current!.sampleCount);
        void endGame(next.score);
      }

      const main = getCanvasCtx(mainCanvasRef);
      if (main) {
        // next.gapHeight is the same computeDifficulty result step() already
        // derived internally — reading it off the state avoids recomputing
        // the ramp a second time every frame just for rendering.
        drawScene(main.ctx, main.canvas.width, main.canvas.height, next, spritesRef.current!);
      }
    },
    [stage, isMuted, endGame, videoRef, canvasRef, startCountdown]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  function enterCameraCheck() {
    cameraCheckStableSinceRef.current = null;
    setStage("CAMERA_CHECK");
  }

  // Unlocks both the SFX AudioContext and the background-music <audio>
  // element via this click's user gesture (play() immediately followed by
  // stop() so nothing audibly starts yet) — the music itself starts later,
  // in beginPlay, once countdown finishes, no second gesture needed.
  function handleStartClick() {
    unlockAudio();
    musicRef.current!.play();
    musicRef.current!.stop();
    enterCameraCheck();
  }

  function toggleMute() {
    setIsMuted((m) => {
      const next = !m;
      musicRef.current?.setMuted(next);
      return next;
    });
  }

  // Aborts the current run (camera check, countdown, or mid-game) back to
  // idle. The in-progress score is discarded: nothing submitted, best untouched.
  function exitToIdle() {
    countdown.cancel();
    resetGameState();
    musicRef.current?.stop();
    recorderRef.current!.stop();
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
    <PresenterLayout accent={flappyHumanMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={mainCanvasRef} className="fixed inset-0 -z-10 h-full w-full bg-black" />
      <canvas
        ref={canvasRef}
        className={"fixed bottom-5 right-5 z-10 rounded-lg border-2 border-white/40 shadow-lg " + (showCameraChrome ? "" : "hidden")}
        style={{ width: CONFIG.CAMERA_PIP_WIDTH, height: CONFIG.CAMERA_PIP_HEIGHT }}
      />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Flappy <span className="text-[var(--accent)]">Human</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-700">
            Flap your real arms to keep the bird airborne. Starts gentle, gets brutal fast.
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

          {process.env.NODE_ENV !== "production" && (
            <button
              onClick={() => recorderRef.current!.download()}
              className="text-sm text-zinc-400 underline hover:text-zinc-600"
            >
              Download flap recording ({recordingSampleCount} samples, dev)
            </button>
          )}
        </div>
      )}

      {showCameraChrome && (
        <button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="fixed left-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-950/60 text-lg text-white"
        >
          {isMuted ? "🔇" : "🔊"}
        </button>
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

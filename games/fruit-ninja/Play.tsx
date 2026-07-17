"use client";
/**
 * Fruit Ninja — single-device camera game.
 *
 * State machine: IDLE -> CAMERA_CHECK -> COUNTDOWN -> PLAYING -> RESULTS.
 * Two players share one webcam; up to four tracked hands all act as blades.
 * Slice fruit for points; missing fruit costs one of 3 shared lives; slicing
 * a single bomb ends the round immediately. Round runs 45s.
 *
 * Camera + model load starts immediately on mount (via useHandTracking) so
 * they're usually ready by the time the host clicks Start.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { useHandTracking } from "@/lib/tracking/useHandTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame } from "@/lib/tracking/drawPose";
import type { HandResult } from "@/lib/tracking/types";
import { createHandTracker, updateHandTracker, type HandDetection, type HandSlot } from "@/lib/fruit-ninja/handTracker";
import { createSpawnState, spawnDue, updateEntities, type Entity, type SpawnConfig } from "@/lib/fruit-ninja/physics";
import { detectSlices, type ComboConfig } from "@/lib/fruit-ninja/detector";
import { drawEntities, drawSplashes, drawHandTrails, type Splash } from "@/lib/fruit-ninja/draw";
import { fruitNinjaMeta } from "./meta";
import { CONFIG } from "./config";
import { drawHud, HAND_COLORS } from "./hud";
import { unlockAudio, playSliceSound, playBombSound, playMissSound, playGameOverSound } from "./sound";
import { getBest, setBest } from "./leaderboard";

const INDEX_FINGERTIP = 8;

type Stage = "IDLE" | "CAMERA_CHECK" | "COUNTDOWN" | "PLAYING" | "RESULTS";

const SPAWN_CONFIG: SpawnConfig = {
  roundDurationMs: CONFIG.ROUND_DURATION_MS,
  intervalStartMs: CONFIG.SPAWN_INTERVAL_START_MS,
  intervalEndMs: CONFIG.SPAWN_INTERVAL_END_MS,
  launchSpeedStart: CONFIG.LAUNCH_SPEED_START,
  launchSpeedEnd: CONFIG.LAUNCH_SPEED_END,
  launchVxMax: CONFIG.LAUNCH_VX_MAX,
  spawnXMargin: CONFIG.SPAWN_X_MARGIN,
  bombProbability: CONFIG.BOMB_PROBABILITY,
  fruitRadius: CONFIG.FRUIT_RADIUS,
  bombRadius: CONFIG.BOMB_RADIUS,
  fruitColors: CONFIG.FRUIT_COLORS,
};
const COMBO_CONFIG: ComboConfig = { enabled: CONFIG.COMBO_ENABLED, bonus: CONFIG.COMBO_BONUS };
const colorForSlot = (_slot: HandSlot, i: number) => HAND_COLORS[i % HAND_COLORS.length];

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IDLE");

  const [best, setBestDisplay] = useState(() => getBest());
  const [isVisible, setIsVisible] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [endReason, setEndReason] = useState<"bomb" | "lives" | "time">("time");

  const trackerRef = useRef(createHandTracker());
  const spawnRef = useRef(createSpawnState());
  const entitiesRef = useRef<Entity[]>([]);
  const splashesRef = useRef<Splash[]>([]);
  const scoreRef = useRef(0);
  const livesRef = useRef(CONFIG.LIVES);
  const playStartRef = useRef(0);
  const lastFrameTRef = useRef(0);
  const endingRef = useRef(false);
  const handleResultRef = useRef<(result: HandResult | null) => void>(() => {});

  // useHandTracking needs a stable onResult reference at call time, but the
  // real handler (below) needs videoRef/canvasRef that useHandTracking
  // itself returns. Forward through a ref to break the circularity.
  const { videoRef, canvasRef, status, errorMessage } = useHandTracking({
    onResult: (result) => handleResultRef.current(result),
  });

  const endRound = useCallback((reason: "bomb" | "lives" | "time") => {
    if (endingRef.current) return;
    endingRef.current = true;
    playGameOverSound();
    setStage("RESULTS");

    const value = scoreRef.current;
    setFinalScore(value);
    setEndReason(reason);

    const prevBest = getBest();
    const isBestRun = value > prevBest;
    if (isBestRun) setBest(value);
    setIsNewBest(isBestRun);
    setBestDisplay(getBest());
  }, []);

  const handleResult = useCallback(
    (result: HandResult | null) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMirroredVideoFrame(ctx, video, canvas);

      const now = performance.now();
      const hands = result?.landmarks ?? [];
      const detections = hands
        .map((landmarks, i): HandDetection | null => {
          const tip = landmarks[INDEX_FINGERTIP];
          if (!tip) return null;
          return { x: tip.x, y: tip.y, handedness: result?.handedness?.[i]?.[0]?.categoryName };
        })
        .filter((d): d is HandDetection => d !== null);
      trackerRef.current = updateHandTracker(trackerRef.current, detections, now);

      if (stage === "CAMERA_CHECK") {
        setIsVisible(trackerRef.current.some((s) => s.active));
        drawHandTrails(ctx, canvas, trackerRef.current, now, colorForSlot);
        return;
      }

      if (stage === "COUNTDOWN") {
        drawHandTrails(ctx, canvas, trackerRef.current, now, colorForSlot);
        return;
      }

      if (stage === "PLAYING") {
        const sinceT = lastFrameTRef.current;
        lastFrameTRef.current = now;
        const elapsed = now - playStartRef.current;

        const due = spawnDue(spawnRef.current, elapsed, SPAWN_CONFIG);
        spawnRef.current = due.state;
        const updated = updateEntities(entitiesRef.current.concat(due.spawned), now - sinceT, CONFIG.GRAVITY);
        let entities = updated.entities;
        if (updated.missedFruit.length > 0) {
          livesRef.current = Math.max(0, livesRef.current - updated.missedFruit.length);
          playMissSound();
        }

        const slices = detectSlices(trackerRef.current, entities, now, sinceT, canvas.width / canvas.height, COMBO_CONFIG);
        const fruitCount = slices.hits.reduce((sum, h) => sum + h.fruitCount, 0);
        const comboBonus = slices.hits.reduce((sum, h) => sum + h.comboBonus, 0);
        if (fruitCount > 0) {
          scoreRef.current += fruitCount * CONFIG.SCORE_PER_FRUIT + comboBonus;
          playSliceSound();
        }
        const bombHit = slices.hits.reduce((sum, h) => sum + h.bombCount, 0) > 0;
        if (bombHit) playBombSound();
        const cut = [...slices.slicedFruit, ...slices.slicedBombs];
        if (cut.length > 0) {
          const cutIds = new Set(cut.map((e) => e.id));
          entities = entities.filter((e) => !cutIds.has(e.id));
          splashesRef.current = splashesRef.current.concat(
            cut.map((e) => ({ x: e.x, y: e.y, radius: e.radius, color: e.kind === "fruit" ? e.color : "#e7e5e4", t: now }))
          );
        }
        entitiesRef.current = entities;
        splashesRef.current = splashesRef.current.filter((s) => now - s.t < CONFIG.SPLASH_MS);

        drawEntities(ctx, canvas, entities);
        drawSplashes(ctx, canvas, splashesRef.current, now, CONFIG.SPLASH_MS);
        drawHandTrails(ctx, canvas, trackerRef.current, now, colorForSlot);
        drawHud(ctx, canvas, scoreRef.current, livesRef.current, Math.max(0, CONFIG.ROUND_DURATION_MS - elapsed));

        if (bombHit) endRound("bomb");
        else if (livesRef.current <= 0) endRound("lives");
        else if (elapsed >= CONFIG.ROUND_DURATION_MS) endRound("time");
      }
    },
    [stage, endRound, videoRef, canvasRef]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  const beginPlay = useCallback(() => {
    spawnRef.current = createSpawnState();
    entitiesRef.current = [];
    splashesRef.current = [];
    scoreRef.current = 0;
    livesRef.current = CONFIG.LIVES;
    endingRef.current = false;
    playStartRef.current = performance.now();
    lastFrameTRef.current = playStartRef.current;
    setStage("PLAYING");
  }, []);

  const countdown = useCountdown({
    from: CONFIG.COUNTDOWN_FROM,
    tickMs: CONFIG.COUNTDOWN_TICK_MS,
    goMs: CONFIG.COUNTDOWN_GO_MS,
    onDone: beginPlay,
  });
  const { start: startCountdown } = countdown;

  function enterCameraCheck() {
    unlockAudio();
    setStage("CAMERA_CHECK");
  }

  function startRound() {
    setStage("COUNTDOWN");
    startCountdown();
  }

  // Aborts the current run back to idle. The in-progress score is discarded.
  function exitToIdle() {
    countdown.cancel();
    scoreRef.current = 0;
    setStage("IDLE");
  }

  return (
    <PresenterLayout accent={fruitNinjaMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="fixed inset-0 -z-10 h-full w-full bg-black object-cover" />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Fruit <span className="text-[var(--accent)]">Ninja</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-700">
            Fruit flies up from the bottom — slice it with your hands, all four count. Miss too much fruit
            and you&apos;re out (3 shared lives) — but cut a single bomb and it&apos;s over instantly. 45 seconds.
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
            notVisibleLabel="Raise a hand into frame"
            visibleLabel="Hands detected"
            onReady={startRound}
            onBack={exitToIdle}
          />
        </div>
      )}

      {stage === "COUNTDOWN" && (
        <p className="text-[14rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
          {countdown.label}
        </p>
      )}

      {stage === "RESULTS" && (
        <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <div>
            <p className="text-8xl font-black leading-none tabular-nums text-[var(--accent)]">{finalScore}</p>
            <p className="text-sm tracking-[0.3em] text-zinc-500">
              {endReason === "bomb" ? "BOOM!" : endReason === "lives" ? "OUT OF LIVES" : "TIME'S UP"}
            </p>
          </div>
          {isNewBest && <p className="text-xl font-extrabold text-pink-600">New best!</p>}
          <p className="text-sm text-zinc-500">Best: {best}</p>

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

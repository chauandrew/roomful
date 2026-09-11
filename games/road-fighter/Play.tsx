"use client";
/**
 * Road Fighter — single-device camera game.
 *
 * State machine: IDLE -> CAMERA_CHECK -> COUNTDOWN -> POSING -> ROUND_RESULT
 * (-> STANCE_CHECK -> COUNTDOWN again, or -> RESULTS once a health bar
 * empties).
 *
 * Two players share one camera, standing side-by-side — MediaPipe detects up
 * to 2 poses per frame (numPoses: 2) and lib/road-fighter/attribution.ts
 * splits them into a Player 1 (left half) / Player 2 (right half) slot each
 * frame. Each side gets its own PoseFighterDetector instance, calibrated
 * continuously through COUNTDOWN (not just once) — STANCE_CHECK is
 * CAMERA_CHECK's exact same visible-and-stable gate, just re-run before
 * every round after the first, so COUNTDOWN's calibration always starts
 * from a deliberate, held stance rather than whatever frame happened to be
 * last when the previous round ended.
 *
 * The "3-2-1-FIGHT!" countdown IS the pose-capture window: entering POSING
 * happens the instant the countdown's label becomes "FIGHT!", and the
 * countdown's own goMs (== CONFIG.POSE_WINDOW_MS) is what closes the window —
 * whoever hasn't locked a pose by then submits null (a round loss), no
 * separate timer needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { usePoseTracking } from "@/lib/tracking/usePoseTracking";
import { useCountdown } from "@/lib/tracking/useCountdown";
import { useCameraCheckAutoAdvance } from "@/lib/tracking/useCameraCheckAutoAdvance";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame, drawSkeleton } from "@/lib/tracking/drawPose";
import type { PoseResult } from "@/lib/tracking/types";
import { attributePlayers } from "./attribution";
import { PoseFighterDetector, isUpperBodyVisible } from "./detector";
import { resolveRound, type RoundOutcome } from "./logic";
import { CONFIG, type Pose } from "./config";
import { roadFighterMeta } from "./meta";
import Tutorial from "./Tutorial";

type Stage = "IDLE" | "CAMERA_CHECK" | "STANCE_CHECK" | "COUNTDOWN" | "POSING" | "ROUND_RESULT" | "RESULTS";

const POSE_LABELS: Record<Pose, string> = {
  hadoken: "Hadoken",
  shoryuken: "Shoryuken",
  punch: "Straight Punch",
  guard: "Iron Guard",
  sonicboom: "Sonic Boom",
};

function HealthBar({ lives, color }: { lives: number; color: string }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: CONFIG.STARTING_LIVES }, (_, i) => (
        <div
          key={i}
          className="h-7 w-16 rounded-sm border-2 border-white/40 transition-colors sm:h-8 sm:w-20"
          style={{ backgroundColor: i < lives ? color : "rgba(255,255,255,0.15)" }}
        />
      ))}
    </div>
  );
}

/** Street-Fighter-style top bar: player labels + health, round count in the middle. */
function TopHud({ p1Lives, p2Lives, round }: { p1Lives: number; p2Lives: number; round: number }) {
  return (
    <div className="fixed inset-x-0 top-0 z-10 flex h-28 items-center justify-between border-b-4 border-white/10 bg-zinc-950 px-6 sm:h-32 sm:px-10">
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-xl font-black tracking-widest text-white sm:text-2xl">P1</span>
        <HealthBar lives={p1Lives} color={CONFIG.PLAYER_COLORS[0]} />
      </div>
      <span className="text-2xl font-black tracking-[0.3em] text-white/70 sm:text-3xl">ROUND {round}</span>
      <div className="flex flex-col items-end gap-1.5">
        <span className="text-xl font-black tracking-widest text-white sm:text-2xl">P2</span>
        <HealthBar lives={p2Lives} color={CONFIG.PLAYER_COLORS[1]} />
      </div>
    </div>
  );
}

/**
 * The match itself — everything that owns a live camera connection
 * (usePoseTracking et al). Split out from Play() so it only mounts (and
 * only acquires the camera) while mode === "match" — see Play() below for
 * why this split exists.
 */
function Match({ onTutorial }: { onTutorial: () => void }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IDLE");

  const [p1Visible, setP1Visible] = useState(false);
  const [p2Visible, setP2Visible] = useState(false);
  const [p1Lives, setP1Lives] = useState(CONFIG.STARTING_LIVES);
  const [p2Lives, setP2Lives] = useState(CONFIG.STARTING_LIVES);
  const [p1Candidate, setP1Candidate] = useState<Pose | null>(null);
  const [p2Candidate, setP2Candidate] = useState<Pose | null>(null);
  const [round, setRound] = useState(1);
  const [roundResult, setRoundResult] = useState<{ p1Pose: Pose | null; p2Pose: Pose | null; outcome: RoundOutcome } | null>(
    null
  );
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [barCollapsed, setBarCollapsed] = useState(false);

  const detector1Ref = useRef<PoseFighterDetector | null>(null);
  if (detector1Ref.current === null) detector1Ref.current = new PoseFighterDetector();
  const detector2Ref = useRef<PoseFighterDetector | null>(null);
  if (detector2Ref.current === null) detector2Ref.current = new PoseFighterDetector();

  const lastFrameTRef = useRef(0);
  const p1LockedRef = useRef<Pose | null>(null);
  const p2LockedRef = useRef<Pose | null>(null);
  const p1PrevCandidateRef = useRef<Pose | null>(null);
  const p2PrevCandidateRef = useRef<Pose | null>(null);
  const p1LivesRef = useRef(CONFIG.STARTING_LIVES);
  const p2LivesRef = useRef(CONFIG.STARTING_LIVES);
  const roundResolvedRef = useRef(false);
  const handleResultRef = useRef<(result: PoseResult | null) => void>(() => {});

  // usePoseTracking needs a stable onResult reference at call time, but the
  // real handler (below) needs videoRef/canvasRef that usePoseTracking
  // itself returns. Forward through a ref to break the circularity.
  const { videoRef, canvasRef, status, errorMessage } = usePoseTracking({
    onResult: (result) => handleResultRef.current(result),
    numPoses: 2,
  });

  // useCountdown needs a stable onDone reference at call time, but the real
  // handler (below) needs to call countdown.cancel() itself — forward
  // through a ref to break the circularity, same trick used throughout
  // lib/tracking/ for this exact kind of two-way dependency.
  const resolveRoundNowRef = useRef<() => void>(() => {});

  const countdown = useCountdown({
    from: CONFIG.COUNTDOWN_FROM,
    tickMs: CONFIG.COUNTDOWN_TICK_MS,
    goMs: CONFIG.POSE_WINDOW_MS,
    goLabel: "FIGHT!",
    onDone: () => resolveRoundNowRef.current(),
  });
  const { start: startCountdownTimer, cancel: cancelCountdown } = countdown;

  const resolveRoundNow = useCallback(() => {
    if (roundResolvedRef.current) return;
    roundResolvedRef.current = true;
    cancelCountdown();

    const p1Pose = p1LockedRef.current;
    const p2Pose = p2LockedRef.current;
    const outcome = resolveRound(p1Pose, p2Pose);

    if (outcome.loser === "a") p1LivesRef.current = Math.max(0, p1LivesRef.current - 1);
    else if (outcome.loser === "b") p2LivesRef.current = Math.max(0, p2LivesRef.current - 1);
    setP1Lives(p1LivesRef.current);
    setP2Lives(p2LivesRef.current);

    setRoundResult({ p1Pose, p2Pose, outcome });
    setStage("ROUND_RESULT");
    if (p1LivesRef.current <= 0 || p2LivesRef.current <= 0) {
      setWinner(p1LivesRef.current <= 0 ? 2 : 1);
    }
  }, [cancelCountdown]);

  useEffect(() => {
    resolveRoundNowRef.current = resolveRoundNow;
  }, [resolveRoundNow]);

  const beginPlaying = useCallback(() => {
    lastFrameTRef.current = 0;
    p1LockedRef.current = null;
    p2LockedRef.current = null;
    p1PrevCandidateRef.current = null;
    p2PrevCandidateRef.current = null;
    roundResolvedRef.current = false;
    detector1Ref.current!.startRound();
    detector2Ref.current!.startRound();
    setP1Candidate(null);
    setP2Candidate(null);
    setBarCollapsed(false);
    setStage("POSING");
  }, []);

  const startRound = useCallback(() => {
    setStage("COUNTDOWN");
    startCountdownTimer();
  }, [startCountdownTimer]);

  const { check: checkCameraStable, reset: resetCameraStable } = useCameraCheckAutoAdvance({
    stabilityMs: CONFIG.READY_STABILITY_MS,
    onReady: startRound,
  });

  // The countdown widget's own label transitioning to "FIGHT!" is the signal
  // to open the pose-capture window — see the file header comment for why
  // this doubles as both the visual countdown and the window timer. Deferred
  // via setTimeout (not requestAnimationFrame) so it still fires in a
  // backgrounded tab, same as the countdown's own onDone timer — pairing a
  // paused-in-background timer here with one that keeps running there could
  // otherwise strand the game mid-countdown.
  useEffect(() => {
    if (stage !== "COUNTDOWN" || countdown.label !== "FIGHT!") return;
    const id = setTimeout(beginPlaying, 0);
    return () => clearTimeout(id);
  }, [stage, countdown.label, beginPlaying]);

  // Collapses the pose-window progress bar via a CSS transition timed to
  // exactly CONFIG.POSE_WINDOW_MS, starting a frame after POSING begins so
  // the transition actually animates instead of snapping straight to 0.
  useEffect(() => {
    if (stage !== "POSING") return;
    const id = requestAnimationFrame(() => setBarCollapsed(true));
    return () => cancelAnimationFrame(id);
  }, [stage]);

  const handleResult = useCallback(
    (result: PoseResult | null) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMirroredVideoFrame(ctx, video, canvas);

      const now = performance.now();
      const aspect = canvas.width / canvas.height;
      const [p1Landmarks, p2Landmarks] = attributePlayers(result?.landmarks ?? [], aspect);

      if (stage === "CAMERA_CHECK" || stage === "STANCE_CHECK") {
        const v1 = isUpperBodyVisible(p1Landmarks);
        const v2 = isUpperBodyVisible(p2Landmarks);
        setP1Visible(v1);
        setP2Visible(v2);
        if (p1Landmarks) drawSkeleton(ctx, canvas, p1Landmarks, CONFIG.PLAYER_COLORS[0]);
        if (p2Landmarks) drawSkeleton(ctx, canvas, p2Landmarks, CONFIG.PLAYER_COLORS[1]);
        checkCameraStable(v1 && v2);
        return;
      }

      if (stage === "COUNTDOWN") {
        // Calibrate every frame (not just once, at the moment "Ready" fired)
        // right up until "FIGHT!" opens the pose window — calibrate() is a
        // no-op on a bad frame (leaves any prior baseline untouched), so this
        // both self-heals a one-off dropout at the exact instant Ready was
        // pressed and uses whichever stance the player actually settles into
        // during the countdown, not whatever they were mid-motion into when
        // they clicked.
        detector1Ref.current!.calibrate(p1Landmarks);
        detector2Ref.current!.calibrate(p2Landmarks);
        if (p1Landmarks) drawSkeleton(ctx, canvas, p1Landmarks, CONFIG.PLAYER_COLORS[0]);
        if (p2Landmarks) drawSkeleton(ctx, canvas, p2Landmarks, CONFIG.PLAYER_COLORS[1]);
        return;
      }

      if (stage === "POSING") {
        const sinceT = lastFrameTRef.current;
        lastFrameTRef.current = now;
        const dtMs = sinceT ? now - sinceT : 0;

        if (p1Landmarks) drawSkeleton(ctx, canvas, p1Landmarks, CONFIG.PLAYER_COLORS[0]);
        if (p2Landmarks) drawSkeleton(ctx, canvas, p2Landmarks, CONFIG.PLAYER_COLORS[1]);

        if (p1LockedRef.current === null) {
          const r1 = detector1Ref.current!.update(p1Landmarks, dtMs);
          if (r1.candidate !== p1PrevCandidateRef.current) {
            p1PrevCandidateRef.current = r1.candidate;
            setP1Candidate(r1.candidate);
          }
          if (r1.locked) p1LockedRef.current = r1.locked;
        }
        if (p2LockedRef.current === null) {
          const r2 = detector2Ref.current!.update(p2Landmarks, dtMs);
          if (r2.candidate !== p2PrevCandidateRef.current) {
            p2PrevCandidateRef.current = r2.candidate;
            setP2Candidate(r2.candidate);
          }
          if (r2.locked) p2LockedRef.current = r2.locked;
        }

        if (p1LockedRef.current !== null && p2LockedRef.current !== null) resolveRoundNow();
        return;
      }
    },
    [stage, canvasRef, videoRef, checkCameraStable, resolveRoundNow]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  // Auto-advances off the reveal screen: back to a stance check before the
  // next round's countdown, or on to the winner screen once a health bar
  // just emptied. A tie/no-pose round (outcome.loser === null) replays the
  // SAME round number, matching the reveal screen's own "replay!" messaging
  // — only a decisive round advances the counter.
  useEffect(() => {
    if (stage !== "ROUND_RESULT") return;
    const t = setTimeout(() => {
      if (winner !== null) {
        setStage("RESULTS");
      } else {
        if (roundResult?.outcome.loser !== null) setRound((r) => r + 1);
        resetCameraStable();
        setStage("STANCE_CHECK");
      }
    }, CONFIG.ROUND_RESULT_MS);
    return () => clearTimeout(t);
  }, [stage, winner, roundResult, resetCameraStable]);

  function enterCameraCheck() {
    resetCameraStable();
    setStage("CAMERA_CHECK");
  }

  function resetMatch() {
    p1LivesRef.current = CONFIG.STARTING_LIVES;
    p2LivesRef.current = CONFIG.STARTING_LIVES;
    setP1Lives(CONFIG.STARTING_LIVES);
    setP2Lives(CONFIG.STARTING_LIVES);
    setWinner(null);
    setRound(1);
    detector1Ref.current!.reset();
    detector2Ref.current!.reset();
  }

  function playAgain() {
    resetMatch();
    enterCameraCheck();
  }

  // Aborts the current run back to idle. The in-progress match is discarded.
  function exitToIdle() {
    countdown.cancel();
    resetMatch();
    resetCameraStable();
    setStage("IDLE");
  }

  return (
    <PresenterLayout accent={roadFighterMeta.accent}>
      <video ref={videoRef} className="hidden" muted playsInline />
      {/* Arcade-cabinet backdrop — fills whatever the aspect-locked canvas
          below doesn't cover, so the sides read as a frame, not empty space. */}
      <div className="fixed inset-0 -z-20 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black" />
      <canvas
        ref={canvasRef}
        className={
          // Height is pinned exactly to the available space (top to bottom);
          // width is left to the canvas's own intrinsic aspect ratio (set via
          // its width/height attributes to match the camera feed) instead of
          // being forced to 100%, so the full video height always shows —
          // cropping the sides instead of the top/bottom when the aspect
          // ratios don't match. object-cover is just a safety net for before
          // the camera's real aspect ratio is known.
          "fixed left-1/2 -translate-x-1/2 bottom-0 -z-10 border-4 border-zinc-800/80 bg-black object-cover shadow-[0_0_80px_rgba(0,0,0,0.7)] sm:border-[10px] " +
          (stage === "CAMERA_CHECK" ||
          stage === "STANCE_CHECK" ||
          stage === "COUNTDOWN" ||
          stage === "POSING" ||
          stage === "ROUND_RESULT"
            ? "top-28 sm:top-32"
            : "top-0")
        }
      />

      {stage === "IDLE" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <h1 className="text-7xl font-black tracking-tight">
            Road <span className="text-[var(--accent)]">Fighter</span>
          </h1>
          <p className="max-w-md text-xl text-zinc-700">
            Two players, one camera, facing each other. Throw a move on &quot;FIGHT!&quot; — Hadoken, Shoryuken,
            Straight Punch, Iron Guard, or Sonic Boom, rock-paper-scissors style: each move beats two of the
            others and loses to the other two. Three rounds to knock out your rival&apos;s health bar.
          </p>
          {status === "error" && <p className="max-w-md font-semibold text-pink-600">{errorMessage}</p>}
          <div className="flex gap-4">
            <button
              onClick={enterCameraCheck}
              disabled={status !== "ready"}
              className="rounded-full bg-[var(--accent)] px-10 py-4 text-xl font-bold text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "loading" ? "Loading…" : status === "error" ? "Unavailable" : "Start"}
            </button>
            <button
              onClick={onTutorial}
              disabled={status !== "ready"}
              className="rounded-full border-2 border-[var(--accent)] px-10 py-4 text-xl font-bold text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Tutorial
            </button>
          </div>
        </div>
      )}

      {stage === "CAMERA_CHECK" && (
        <div className="rounded-2xl bg-[var(--background)]/95 p-10 shadow-lg backdrop-blur-sm">
          <CameraCheck
            isVisible={p1Visible && p2Visible}
            stabilityMs={CONFIG.READY_STABILITY_MS}
            notVisibleLabel="Stand side-by-side, facing the camera — upper body in frame is enough, no need to fit your legs"
            visibleLabel="Both players detected"
            onReady={startRound}
            onBack={exitToIdle}
          />
        </div>
      )}

      {stage === "STANCE_CHECK" && (
        <div className="rounded-2xl bg-[var(--background)]/95 p-10 shadow-lg backdrop-blur-sm">
          <CameraCheck
            isVisible={p1Visible && p2Visible}
            stabilityMs={CONFIG.READY_STABILITY_MS}
            notVisibleLabel="Reset to your fighting stance — fists up, elbows bent"
            visibleLabel="Ready!"
            onReady={startRound}
            onBack={exitToIdle}
          />
        </div>
      )}

      {stage === "COUNTDOWN" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-2xl font-bold tracking-wide text-white/80 drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
            Choose your move in…
          </p>
          <p className="text-[14rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
            {countdown.label}
          </p>
        </div>
      )}

      {stage === "POSING" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 top-28 flex flex-col items-center justify-start gap-4 pt-10 sm:top-32">
          <p className="text-8xl font-black text-white drop-shadow-[0_8px_40px_rgba(0,0,0,0.6)] sm:text-9xl">
            FIGHT!
          </p>
          <div className="h-3 w-80 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white"
              style={{
                width: barCollapsed ? "0%" : "100%",
                transition: barCollapsed ? `width ${CONFIG.POSE_WINDOW_MS}ms linear` : "none",
              }}
            />
          </div>
          <div className="mt-6 flex gap-16 text-5xl font-black sm:gap-24 sm:text-6xl">
            <span style={{ color: CONFIG.PLAYER_COLORS[0] }}>{p1Candidate ? POSE_LABELS[p1Candidate] : "…"}</span>
            <span style={{ color: CONFIG.PLAYER_COLORS[1] }}>{p2Candidate ? POSE_LABELS[p2Candidate] : "…"}</span>
          </div>
        </div>
      )}

      {stage === "ROUND_RESULT" && roundResult && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-12 text-center shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-10">
            <p className="text-5xl font-black sm:text-6xl" style={{ color: CONFIG.PLAYER_COLORS[0] }}>
              {roundResult.p1Pose ? POSE_LABELS[roundResult.p1Pose] : "No pose"}
            </p>
            <p className="text-3xl font-black text-zinc-400">vs</p>
            <p className="text-5xl font-black sm:text-6xl" style={{ color: CONFIG.PLAYER_COLORS[1] }}>
              {roundResult.p2Pose ? POSE_LABELS[roundResult.p2Pose] : "No pose"}
            </p>
          </div>
          <p className="text-3xl font-bold text-[var(--accent)]">
            {roundResult.outcome.loser === null
              ? roundResult.outcome.reason === "double-no-pose"
                ? "Nobody struck a pose — replay!"
                : "Tie — replay!"
              : roundResult.outcome.loser === "a"
                ? "Player 1 takes a hit!"
                : "Player 2 takes a hit!"}
          </p>
        </div>
      )}

      {stage === "RESULTS" && (
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
          <p className="text-6xl font-black" style={{ color: winner === 1 ? CONFIG.PLAYER_COLORS[0] : CONFIG.PLAYER_COLORS[1] }}>
            Player {winner} Wins!
          </p>
          <button
            onClick={playAgain}
            className="rounded-full bg-[var(--accent)] px-8 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
          >
            Play again
          </button>
        </div>
      )}

      {(stage === "CAMERA_CHECK" ||
        stage === "STANCE_CHECK" ||
        stage === "COUNTDOWN" ||
        stage === "POSING" ||
        stage === "ROUND_RESULT") && <TopHud p1Lives={p1Lives} p2Lives={p2Lives} round={round} />}

      {(stage === "CAMERA_CHECK" ||
        stage === "STANCE_CHECK" ||
        stage === "COUNTDOWN" ||
        stage === "POSING" ||
        stage === "ROUND_RESULT") && (
        <button
          onClick={exitToIdle}
          aria-label="Exit to start screen"
          className="fixed right-5 top-32 z-20 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-950/60 text-lg text-white sm:top-36"
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

export default function Play() {
  // "tutorial" swaps the entire render tree for <Tutorial> instead of
  // <Match> — a separate path, not a stage within the match. Each owns its
  // own camera connection, and only one is ever mounted at a time, so
  // there's never a conflict between two simultaneous getUserMedia calls
  // fighting over the same camera (which previously made the match's own
  // camera come back broken — a black screen — after visiting the
  // tutorial and returning).
  const [mode, setMode] = useState<"match" | "tutorial">("match");

  if (mode === "tutorial") {
    return (
      <PresenterLayout accent={roadFighterMeta.accent}>
        <Tutorial onExit={() => setMode("match")} />
      </PresenterLayout>
    );
  }

  return <Match onTutorial={() => setMode("tutorial")} />;
}

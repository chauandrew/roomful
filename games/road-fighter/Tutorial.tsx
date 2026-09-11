"use client";
/**
 * Road Fighter tutorial — shows all 5 moves at once per player; holding any
 * one of them for TUTORIAL_CONFIRM_MS checks it off, in any order. No
 * curriculum sequence, no beats matrix (see games/road-fighter/config.ts's
 * BEATS) — this is just "how do I do each move," not strategy.
 *
 * Works solo or with two: CAMERA_CHECK only waits for at least one player
 * (unlike the real match's CameraCheck, which needs both), and a second
 * player can step in mid-tutorial and get calibrated on their first frame —
 * each side then checks off moves independently, at their own pace.
 *
 * Reuses the same camera/tracking/detector stack as Play.tsx (this is a
 * separate component/path per the user's ask, not a separate game — no
 * registry entry, Play.tsx just renders this instead of the match when the
 * player picks "Tutorial").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePoseTracking } from "@/lib/tracking/usePoseTracking";
import { useCameraCheckAutoAdvance } from "@/lib/tracking/useCameraCheckAutoAdvance";
import { CameraCheck } from "@/lib/tracking/CameraCheck";
import { drawMirroredVideoFrame, drawSkeleton, drawCenterLine } from "@/lib/tracking/drawPose";
import type { PoseResult } from "@/lib/tracking/types";
import { PlayerAttributor } from "./attribution";
import { PoseFighterDetector, isUpperBodyVisible } from "./detector";
import { CONFIG, type Pose } from "./config";

type Stage = "CAMERA_CHECK" | "INTRO" | "TEACHING" | "DONE";

// The match locks a move fast (CONFIG.STABLE_MS) since a round is timed —
// but that's quick enough here that a beginner can't tell they actually
// held it. Teaching requires a full second instead, using the detector's
// raw (non-locking) `candidate` field rather than its `locked` output.
const TUTORIAL_CONFIRM_MS = 1000;

// How long the intro splash (all 5 moves, no instructions) stays up before
// auto-advancing into the HUD.
const INTRO_MS = 3500;

const CURRICULUM: Array<{ pose: Pose; label: string; instruction: string }> = [
  { pose: "hadoken", label: "Hadoken", instruction: "Push both hands forward together, like throwing a fireball." },
  {
    pose: "shoryuken",
    label: "Shoryuken",
    instruction: "Punch one fist straight up overhead, the other hand down at your hip.",
  },
  {
    pose: "punch",
    label: "Straight Punch",
    instruction: "Punch one arm straight out toward the camera, the other hand tucked back at your side.",
  },
  {
    pose: "guard",
    label: "Iron Guard",
    instruction: "Cross both arms over your chest, fists near your opposite shoulder — the Wakanda salute.",
  },
  { pose: "sonicboom", label: "Sonic Boom", instruction: "Raise both arms straight up overhead, together." },
];

interface TutorialProps {
  onExit: () => void;
}

/** Stick-figure limb coordinates per move, in a shared 100x140 viewBox — a
 * simplified, static echo of the live skeleton overlay so a player can see
 * the shape they're aiming for, not just read about it. */
const STICK_FIGURES: Record<Pose, { arms: [number, number][][]; legs: [number, number][][] }> = {
  hadoken: {
    arms: [
      [
        [42, 34],
        [72, 44],
      ],
      [
        [58, 34],
        [78, 46],
      ],
    ],
    legs: [
      [
        [50, 80],
        [38, 125],
      ],
      [
        [50, 80],
        [62, 125],
      ],
    ],
  },
  shoryuken: {
    arms: [
      [
        [42, 34],
        [35, 75],
      ],
      [
        [58, 34],
        [58, 5],
      ],
    ],
    legs: [
      [
        [50, 80],
        [38, 125],
      ],
      [
        [50, 80],
        [62, 125],
      ],
    ],
  },
  punch: {
    // One arm extends straight out toward the camera, the other stays
    // tucked back — upper-body only, no leg involvement at all.
    arms: [
      [
        [42, 34],
        [38, 42],
      ],
      [
        [58, 34],
        [90, 38],
      ],
    ],
    legs: [
      [
        [50, 80],
        [38, 125],
      ],
      [
        [50, 80],
        [62, 125],
      ],
    ],
  },
  guard: {
    // Wakanda salute — arms cross over the chest, each fist landing near the
    // OPPOSITE shoulder, forming an X.
    arms: [
      [
        [42, 34],
        [60, 52],
      ],
      [
        [58, 34],
        [40, 52],
      ],
    ],
    legs: [
      [
        [50, 80],
        [38, 125],
      ],
      [
        [50, 80],
        [62, 125],
      ],
    ],
  },
  sonicboom: {
    // Both arms raised straight up overhead, together — reaches up, not
    // sideways, so two players standing side by side don't collide.
    arms: [
      [
        [42, 34],
        [36, 16],
        [34, 3],
      ],
      [
        [58, 34],
        [64, 16],
        [66, 3],
      ],
    ],
    legs: [
      [
        [50, 80],
        [38, 125],
      ],
      [
        [50, 80],
        [62, 125],
      ],
    ],
  },
};

function StickFigureSvg({
  figure,
  color,
  className = "h-32 w-24 sm:h-40 sm:w-28",
}: {
  figure: { arms: readonly (readonly (readonly number[])[])[]; legs: readonly (readonly (readonly number[])[])[] };
  color: string;
  className?: string;
}) {
  const shoulderCenter: [number, number] = [50, 32];
  const hip: [number, number] = [50, 80];
  const toPoints = (pts: readonly (readonly number[])[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg viewBox="0 0 100 140" className={className}>
      <circle cx={50} cy={20} r={10} fill="none" stroke={color} strokeWidth={4} />
      <polyline
        points={toPoints([shoulderCenter, hip])}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
      />
      {figure.arms.map((points, i) => (
        <polyline
          key={`arm-${i}`}
          points={toPoints(points)}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {figure.legs.map((points, i) => (
        <polyline
          key={`leg-${i}`}
          points={toPoints(points)}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** One move's chip in the top HUD — a small icon, green + checkmark once
 * completed, glowing in the player's color while it's the one being held. */
function MoveChip({
  pose,
  label,
  color,
  completed,
  holding,
}: {
  pose: Pose;
  label: string;
  color: string;
  completed: boolean;
  holding: boolean;
}) {
  return (
    <div
      title={label}
      className={
        "flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 transition-colors sm:h-20 sm:w-20 " +
        (completed ? "border-emerald-500 bg-emerald-500/20" : holding ? "bg-white/10" : "border-white/20 bg-white/5")
      }
      style={holding && !completed ? { borderColor: color, boxShadow: `0 0 0 3px ${color}66` } : undefined}
    >
      {completed ? (
        <span className="text-3xl text-emerald-500 sm:text-4xl">✓</span>
      ) : (
        <StickFigureSvg figure={STICK_FIGURES[pose]} color={color} className="h-11 w-8 sm:h-14 sm:w-10" />
      )}
    </div>
  );
}

/** One player's half of the top HUD: label, a row of 5 move chips, and a
 * caption that names whichever move is currently being held (or the idle
 * hint) — small footprint on purpose, so the camera feed stays visible. */
function PlayerHud({
  color,
  align,
  playerLabel,
  active,
  completed,
  holding,
}: {
  color: string;
  align: "start" | "end";
  playerLabel: string;
  active: boolean;
  completed: Set<Pose>;
  holding: Pose | null;
}) {
  const done = completed.size >= CURRICULUM.length;
  const holdingMove = CURRICULUM.find((c) => c.pose === holding);
  return (
    <div className={"flex flex-col gap-1.5 " + (align === "end" ? "items-end" : "items-start")}>
      <span className="text-lg font-black tracking-widest text-white sm:text-xl">{playerLabel}</span>
      {!active ? (
        <span className="text-sm text-zinc-400 sm:text-base">Step into frame</span>
      ) : done ? (
        <span className="text-lg font-black sm:text-xl" style={{ color }}>
          All 5 learned! ✓
        </span>
      ) : (
        <>
          <div className={"flex gap-2 sm:gap-3 " + (align === "end" ? "flex-row-reverse" : "")}>
            {CURRICULUM.map(({ pose, label }) => (
              <MoveChip
                key={pose}
                pose={pose}
                label={label}
                color={color}
                completed={completed.has(pose)}
                holding={holding === pose}
              />
            ))}
          </div>
          <span className="max-w-[42vw] truncate text-sm text-zinc-400 sm:text-base">
            {holdingMove ? `${holdingMove.label}: ${holdingMove.instruction}` : "Hold any move for 1 second"}
          </span>
        </>
      )}
    </div>
  );
}

export default function Tutorial({ onExit }: TutorialProps) {
  const [stage, setStage] = useState<Stage>("CAMERA_CHECK");
  const [p1Visible, setP1Visible] = useState(false);
  const [p2Visible, setP2Visible] = useState(false);
  const [p1Active, setP1Active] = useState(false);
  const [p2Active, setP2Active] = useState(false);
  const [p1Completed, setP1Completed] = useState<Set<Pose>>(() => new Set());
  const [p2Completed, setP2Completed] = useState<Set<Pose>>(() => new Set());
  const [p1Holding, setP1Holding] = useState<Pose | null>(null);
  const [p2Holding, setP2Holding] = useState<Pose | null>(null);

  const detector1Ref = useRef<PoseFighterDetector | null>(null);
  if (detector1Ref.current === null) detector1Ref.current = new PoseFighterDetector();
  const detector2Ref = useRef<PoseFighterDetector | null>(null);
  if (detector2Ref.current === null) detector2Ref.current = new PoseFighterDetector();
  const attributorRef = useRef<PlayerAttributor | null>(null);
  if (attributorRef.current === null) attributorRef.current = new PlayerAttributor();

  const lastFrameTRef = useRef(0);
  const p1ActiveRef = useRef(false);
  const p2ActiveRef = useRef(false);
  const p1CompletedRef = useRef<Set<Pose>>(new Set());
  const p2CompletedRef = useRef<Set<Pose>>(new Set());
  const p1HoldPoseRef = useRef<Pose | null>(null);
  const p2HoldPoseRef = useRef<Pose | null>(null);
  const p1HoldMsRef = useRef(0);
  const p2HoldMsRef = useRef(0);
  const handleResultRef = useRef<(result: PoseResult | null) => void>(() => {});

  const { videoRef, canvasRef, status, errorMessage } = usePoseTracking({
    onResult: (result) => handleResultRef.current(result),
    numPoses: 2,
  });

  const showIntro = useCallback(() => setStage("INTRO"), []);

  const startTeaching = useCallback(() => {
    lastFrameTRef.current = 0;
    setStage("TEACHING");
  }, []);

  // Only one player needs to be visible to start — solo practice is fine,
  // unlike the real match's CameraCheck, which requires both. Camera check
  // leads into a one-time INTRO screen (not straight into teaching) so a
  // first-time player sees all 5 moves laid out before the HUD shrinks them.
  const { check: checkCameraStable, reset: resetCameraStable } = useCameraCheckAutoAdvance({
    stabilityMs: CONFIG.READY_STABILITY_MS,
    onReady: showIntro,
  });

  const handleResult = useCallback(
    (result: PoseResult | null) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMirroredVideoFrame(ctx, video, canvas);
      drawCenterLine(ctx, canvas);

      const now = performance.now();
      const aspect = canvas.width / canvas.height;
      const [p1Landmarks, p2Landmarks] = attributorRef.current!.attribute(result?.landmarks ?? [], aspect);

      if (stage === "CAMERA_CHECK") {
        const v1 = isUpperBodyVisible(p1Landmarks);
        const v2 = isUpperBodyVisible(p2Landmarks);
        setP1Visible(v1);
        setP2Visible(v2);
        if (p1Landmarks) drawSkeleton(ctx, canvas, p1Landmarks, CONFIG.PLAYER_COLORS[0]);
        if (p2Landmarks) drawSkeleton(ctx, canvas, p2Landmarks, CONFIG.PLAYER_COLORS[1]);
        if (v1) detector1Ref.current!.calibrate(p1Landmarks);
        if (v2) detector2Ref.current!.calibrate(p2Landmarks);
        checkCameraStable(v1 || v2);
        return;
      }

      if (stage === "TEACHING") {
        const sinceT = lastFrameTRef.current;
        lastFrameTRef.current = now;
        const dtMs = sinceT ? now - sinceT : 0;

        if (p1Landmarks) drawSkeleton(ctx, canvas, p1Landmarks, CONFIG.PLAYER_COLORS[0]);
        if (p2Landmarks) drawSkeleton(ctx, canvas, p2Landmarks, CONFIG.PLAYER_COLORS[1]);

        // Calibrate every frame, not just once — same reasoning as Play.tsx's
        // COUNTDOWN recalibration: calibrate() is a no-op on a bad frame
        // (leaves any prior baseline untouched), so this both self-heals a
        // player whose wrists weren't visible yet on their first tracked
        // frame (torso-only visibility is enough to count as "in frame", see
        // attribution.ts, but calibrate() itself needs the wrists too) and
        // keeps the shoulder-width normalizer current if a player drifts
        // closer or farther from the camera mid-tutorial.
        if (p1Landmarks) detector1Ref.current!.calibrate(p1Landmarks);
        if (p2Landmarks) detector2Ref.current!.calibrate(p2Landmarks);
        if (p1Landmarks && !p1ActiveRef.current) {
          p1ActiveRef.current = true;
          setP1Active(true);
        }
        if (p2Landmarks && !p2ActiveRef.current) {
          p2ActiveRef.current = true;
          setP2Active(true);
        }

        if (p1ActiveRef.current && p1CompletedRef.current.size < CURRICULUM.length) {
          const r1 = detector1Ref.current!.update(p1Landmarks, dtMs);
          const candidate1 = r1.candidate && !p1CompletedRef.current.has(r1.candidate) ? r1.candidate : null;
          if (candidate1 === p1HoldPoseRef.current) {
            p1HoldMsRef.current += dtMs;
          } else {
            p1HoldPoseRef.current = candidate1;
            p1HoldMsRef.current = 0;
            setP1Holding(candidate1);
          }
          if (candidate1 && p1HoldMsRef.current >= TUTORIAL_CONFIRM_MS) {
            p1CompletedRef.current = new Set(p1CompletedRef.current).add(candidate1);
            setP1Completed(p1CompletedRef.current);
            p1HoldPoseRef.current = null;
            p1HoldMsRef.current = 0;
            setP1Holding(null);
          }
        }
        if (p2ActiveRef.current && p2CompletedRef.current.size < CURRICULUM.length) {
          const r2 = detector2Ref.current!.update(p2Landmarks, dtMs);
          const candidate2 = r2.candidate && !p2CompletedRef.current.has(r2.candidate) ? r2.candidate : null;
          if (candidate2 === p2HoldPoseRef.current) {
            p2HoldMsRef.current += dtMs;
          } else {
            p2HoldPoseRef.current = candidate2;
            p2HoldMsRef.current = 0;
            setP2Holding(candidate2);
          }
          if (candidate2 && p2HoldMsRef.current >= TUTORIAL_CONFIRM_MS) {
            p2CompletedRef.current = new Set(p2CompletedRef.current).add(candidate2);
            setP2Completed(p2CompletedRef.current);
            p2HoldPoseRef.current = null;
            p2HoldMsRef.current = 0;
            setP2Holding(null);
          }
        }
        return;
      }
    },
    [stage, canvasRef, videoRef, checkCameraStable]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  // INTRO is a timed splash, not a stage the player has to dismiss.
  useEffect(() => {
    if (stage !== "INTRO") return;
    const id = setTimeout(startTeaching, INTRO_MS);
    return () => clearTimeout(id);
  }, [stage, startTeaching]);

  // Once every player who ever showed up has learned all 5 moves.
  useEffect(() => {
    if (stage !== "TEACHING") return;
    const p1Done = !p1Active || p1Completed.size >= CURRICULUM.length;
    const p2Done = !p2Active || p2Completed.size >= CURRICULUM.length;
    if (!((p1Active || p2Active) && p1Done && p2Done)) return;
    const id = setTimeout(() => setStage("DONE"), 0);
    return () => clearTimeout(id);
  }, [stage, p1Active, p2Active, p1Completed, p2Completed]);

  function exitTutorial() {
    resetCameraStable();
    onExit();
  }

  return (
    <>
      <video ref={videoRef} className="hidden" muted playsInline />
      {/* Arcade-cabinet backdrop — fills whatever the aspect-locked canvas
          below doesn't cover, so the sides read as a frame, not empty space. */}
      <div className="fixed inset-0 -z-20 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black" />
      {/* Height is pinned to the available space (below the HUD, when one's
          showing); width follows the canvas's own intrinsic aspect ratio
          (matches the camera feed) instead of being forced to 100%, so the
          full video height always shows — the sides crop instead. */}
      <canvas
        ref={canvasRef}
        className="fixed left-1/2 top-40 bottom-0 -translate-x-1/2 -z-10 border-4 border-zinc-800/80 bg-black object-cover shadow-[0_0_80px_rgba(0,0,0,0.7)] sm:top-52 sm:border-[10px]"
      />

      {/* Rendered from the start (not just once TEACHING begins) so the
          video's top offset never jumps when this appears. */}
      <div className="fixed inset-x-0 top-0 z-10 flex h-40 items-start justify-between gap-4 border-b-4 border-white/10 bg-zinc-950 px-6 py-4 sm:h-52 sm:px-10 sm:py-6">
        <PlayerHud
          color={CONFIG.PLAYER_COLORS[0]}
          align="start"
          playerLabel="P1"
          active={p1Active}
          completed={p1Completed}
          holding={p1Holding}
        />
        <PlayerHud
          color={CONFIG.PLAYER_COLORS[1]}
          align="end"
          playerLabel="P2"
          active={p2Active}
          completed={p2Completed}
          holding={p2Holding}
        />
      </div>

      {/* Each stage card centers itself within the space below the always-on
          HUD above, instead of PresenterLayout's full-viewport centering —
          otherwise a card can render partly behind the HUD bar. */}
      {stage === "CAMERA_CHECK" && (
        <div className="fixed inset-0 top-40 z-0 flex items-center justify-center p-6 sm:top-52">
          <div className="rounded-2xl bg-[var(--background)]/95 p-10 shadow-lg backdrop-blur-sm">
            {status === "error" ? (
              <p className="max-w-md font-semibold text-pink-600">{errorMessage}</p>
            ) : (
              <CameraCheck
                isVisible={p1Visible || p2Visible}
                stabilityMs={CONFIG.READY_STABILITY_MS}
                notVisibleLabel="Step into frame, upper body visible — practice alone or with a friend"
                visibleLabel="Ready!"
                onReady={showIntro}
                onBack={exitTutorial}
              />
            )}
          </div>
        </div>
      )}

      {stage === "INTRO" && (
        <div className="fixed inset-0 top-40 z-0 flex items-center justify-center p-6 sm:top-52">
          <div className="max-w-3xl rounded-2xl bg-[var(--background)]/95 p-8 text-center shadow-lg backdrop-blur-sm sm:p-10">
            <h2 className="mb-6 text-3xl font-black sm:text-4xl">5 Moves</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:gap-4">
              {CURRICULUM.map(({ pose, label }) => (
                <div key={pose} className="flex flex-col items-center gap-2 rounded-xl bg-zinc-500/5 p-3">
                  <StickFigureSvg figure={STICK_FIGURES[pose]} color="#71717a" className="h-16 w-12" />
                  <p className="text-center text-sm font-black">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {stage === "DONE" && (
        <div className="fixed inset-0 top-40 z-0 flex items-center justify-center p-6 sm:top-52">
          <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
            <p className="text-4xl font-black text-[var(--accent)]">All 5 moves learned!</p>
            <button
              onClick={exitTutorial}
              className="rounded-full bg-[var(--accent)] px-8 py-3 text-lg font-bold text-zinc-950 hover:brightness-110"
            >
              Back to menu
            </button>
          </div>
        </div>
      )}

      {stage !== "DONE" && (
        <button
          onClick={exitTutorial}
          aria-label="Exit tutorial"
          className="fixed right-5 top-44 z-20 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-zinc-950/60 text-lg text-white sm:top-56"
        >
          ✕
        </button>
      )}
    </>
  );
}

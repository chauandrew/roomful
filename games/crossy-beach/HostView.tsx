"use client";
/**
 * Crossy Beach — projector screen. Renders the Frogger board on a canvas at
 * display refresh rate (lerping between server snapshots), shows the HUD
 * (level, lives, tide timer, who-owns-which-button legend), and — crucially —
 * DRIVES THE GAME CLOCK: the server has no timer of its own, so this
 * component sends { type: "tick", dtMs } every TICK_MS while a level runs.
 */
import { useEffect, useRef } from "react";
import { BarButton, ControlBar } from "@/components/PresenterLayout";
import type { HostViewProps } from "@/games/clientTypes";
import { COLS, ROWS, TICK_MS } from "./config";
import type { Dir, HostViewData, SoundKind } from "./config";
import { drawBoard } from "./draw";
import {
  unlockAudio,
  playHop,
  playSplat,
  playSplash,
  playPeck,
  playLevelup,
  playTimeout,
  playWin,
  playGameover,
} from "./sound";

const SOUND_PLAYERS: Record<SoundKind, () => void> = {
  hop: playHop,
  splat: playSplat,
  splash: playSplash,
  peck: playPeck,
  levelup: playLevelup,
  timeout: playTimeout,
  win: playWin,
  gameover: playGameover,
};

const DIR_GLYPH: Record<Dir, string> = { up: "⬆️", down: "⬇️", left: "⬅️", right: "➡️" };

export default function HostView({ view, sendGameAction, sendHostAction }: HostViewProps) {
  const g = view.game as HostViewData;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── snapshot buffer for interpolation ────────────────────────────────────
  // Syncs arrive at TICK_MS granularity; the rAF loop lerps entity positions
  // between the previous and current snapshot using their arrival time.
  const snapRef = useRef<{ prev: HostViewData | null; curr: HostViewData; at: number } | null>(null);
  const hopAtRef = useRef(0);
  useEffect(() => {
    const prev = snapRef.current?.curr ?? null;
    if (prev === g) return;
    if (prev && (prev.turtle.row !== g.turtle.row || prev.turtle.x !== g.turtle.x)) {
      hopAtRef.current = performance.now();
    }
    snapRef.current = { prev, curr: g, at: performance.now() };
  }, [g]);

  // ── tick driver ──────────────────────────────────────────────────────────
  const ticking = g.phase === "level-intro" || g.phase === "running";
  useEffect(() => {
    if (!ticking) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      // The reducer clamps dt, so a backgrounded tab pauses rather than jumps.
      sendGameAction({ type: "tick", dtMs: now - last });
      last = now;
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ticking, sendGameAction]);

  // ── render loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const snap = snapRef.current;
      if (!canvas || !snap) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w === 0 || h === 0) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const now = performance.now();
      drawBoard(ctx, w, h, {
        curr: snap.curr,
        prev: snap.prev,
        t: Math.min(1, (now - snap.at) / TICK_MS),
        nowMs: now,
        hopAtMs: hopAtRef.current,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── sounds ───────────────────────────────────────────────────────────────
  const lastSoundId = useRef<number | null>(null);
  useEffect(() => {
    const s = g.sound;
    if (!s || s.id === lastSoundId.current) return;
    lastSoundId.current = s.id;
    SOUND_PLAYERS[s.kind]();
  }, [g.sound]);

  // The host clicked Start on this same page, so resuming on mount often
  // already works; the gesture listeners cover strict browsers.
  useEffect(() => {
    unlockAudio();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center gap-3">
      {/* HUD header: level, lives, tide timer */}
      <div className="flex w-full max-w-6xl items-center gap-8 px-2">
        <p className="whitespace-nowrap text-3xl font-black">
          <span className="text-[var(--accent)]">Level {g.level + 1}/4</span> · {g.levelName}
        </p>
        <div className="relative h-5 flex-1 rounded-full bg-zinc-300/60">
          <div
            className="h-full rounded-full bg-[var(--accent)]"
            style={{ width: `${g.timerFrac * 100}%` }}
          />
          <span
            className="absolute -top-3 -translate-x-1/2 text-3xl transition-[left] duration-150 ease-linear"
            style={{ left: `${(1 - g.timerFrac) * 100}%` }}
          >
            ☀️
          </span>
          <span className="absolute -right-2 -top-3 translate-x-full text-3xl">🌅</span>
        </div>
        <p className="whitespace-nowrap text-3xl" aria-label={`${g.lives} lives`}>
          {"🐢".repeat(Math.max(0, g.lives))}
        </p>
      </div>

      {/* board */}
      <div className="relative flex min-h-0 w-full flex-1 justify-center">
        <canvas
          ref={canvasRef}
          className="h-full rounded-xl shadow-lg"
          style={{ aspectRatio: `${COLS} / ${ROWS}` }}
        />

        {g.phase === "level-intro" && (
          <Overlay>
            <p className="text-6xl font-black">
              Level {g.level + 1}: <span className="text-[var(--accent)]">{g.levelName}</span>
            </p>
            <p className="text-3xl text-zinc-600">{g.tagline}</p>
            {g.level > 0 && (
              <p className="animate-pulse text-2xl font-bold">
                🔀 Controls shuffled — check your phone!
              </p>
            )}
          </Overlay>
        )}

        {g.phase === "won" && (
          <Overlay>
            <p className="text-7xl">🎉🐢🌊</p>
            <p className="text-6xl font-black text-[var(--accent)]">
              The hatchling made it to the sea!
            </p>
            <Stats g={g} />
          </Overlay>
        )}

        {g.phase === "gameover" && (
          <Overlay>
            <p className="text-7xl">🐢💤</p>
            <p className="text-5xl font-black">The hatchling got tired…</p>
            <p className="text-2xl text-zinc-600">Tomorrow&apos;s another sunrise. Try again?</p>
            <Stats g={g} />
          </Overlay>
        )}
      </div>

      {/* controls legend — big enough to read (and yell at people) from across a room */}
      <div className="flex w-full max-w-6xl items-stretch justify-center gap-4">
        {g.controls.map((c) => (
          <div key={c.dir} className="flex-1 rounded-xl bg-zinc-900/5 px-4 py-2 text-center">
            <p className="text-4xl">{DIR_GLYPH[c.dir]}</p>
            <p className="truncate text-2xl font-bold">
              {c.names.length > 0 ? c.names.join(", ") : "—"}
            </p>
          </div>
        ))}
      </div>

      {g.phase === "won" || g.phase === "gameover" ? (
        <ControlBar>
          <BarButton onClick={() => sendHostAction({ kind: "end" })}>End game</BarButton>
          <BarButton onClick={() => sendHostAction({ kind: "restart" })}>Back to lobby</BarButton>
          {g.phase === "gameover" && (
            <BarButton onClick={() => sendGameAction({ type: "play-again" })}>
              Restart from Level 1
            </BarButton>
          )}
          <BarButton
            primary
            onClick={() =>
              sendGameAction(
                g.phase === "gameover" ? { type: "play-again", atLevel: g.level } : { type: "play-again" }
              )
            }
          >
            {g.phase === "gameover" ? `Retry Level ${g.level + 1}` : "Play again"}
          </BarButton>
        </ControlBar>
      ) : (
        <ControlBar>
          <BarButton onClick={() => sendHostAction({ kind: "end" })}>End</BarButton>
          {process.env.NODE_ENV !== "production" && (
            <BarButton onClick={() => sendGameAction({ type: "skip-level" })}>
              Skip level (dev)
            </BarButton>
          )}
        </ControlBar>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex max-w-3xl flex-col items-center gap-4 rounded-2xl bg-[var(--background)]/95 p-10 text-center shadow-lg backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}

function Stats({ g }: { g: HostViewData }) {
  return (
    <div className="mt-2 text-2xl text-zinc-700">
      {[...g.stats]
        .sort((a, b) => b.hops - a.hops)
        .map((s, i) => (
          <p key={i}>
            <span className="font-bold">{s.name}</span> — {s.hops} hop{s.hops === 1 ? "" : "s"}
          </p>
        ))}
      <p className="mt-2 text-xl text-zinc-500">
        {g.totalDeaths} tumble{g.totalDeaths === 1 ? "" : "s"} along the way
      </p>
    </div>
  );
}

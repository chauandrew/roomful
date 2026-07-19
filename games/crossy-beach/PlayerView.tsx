"use client";
/**
 * Crossy Beach — phone screen. The whole phone is one or two giant direction
 * buttons; controls reshuffle between levels, so the level intro shouts which
 * buttons this phone owns NOW. Inputs fire on pointerdown (latency matters).
 */
import { useEffect, useRef, useState } from "react";
import type { PlayerViewProps } from "@/games/clientTypes";
import { PLAYER_COOLDOWN_MS } from "./config";
import type { Dir, PlayerViewData } from "./config";

const DIR_GLYPH: Record<Dir, string> = { up: "⬆️", down: "⬇️", left: "⬅️", right: "➡️" };
const DIR_WORD: Record<Dir, string> = { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT" };

export default function PlayerView({ view, sendInput }: PlayerViewProps) {
  const g = view.game as PlayerViewData;

  // Mirrors the server's per-player cooldown so the button visibly "recharges"
  // instead of silently eating presses.
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = (dir: Dir) => {
    if (cooling) return;
    sendInput({ dir });
    navigator.vibrate?.(20);
    setCooling(true);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = setTimeout(() => setCooling(false), PLAYER_COOLDOWN_MS);
  };
  useEffect(() => () => {
    if (coolTimer.current) clearTimeout(coolTimer.current);
  }, []);

  if (g.phase === "won") {
    return (
      <div className="text-center">
        <p className="text-6xl">🎉</p>
        <p className="mt-4 text-3xl font-black">You did it!</p>
        <p className="mt-2 text-xl text-zinc-600">Look at the big screen!</p>
      </div>
    );
  }

  if (g.phase === "gameover") {
    return (
      <div className="text-center">
        <p className="text-6xl">😢</p>
        <p className="mt-4 text-3xl font-black">The hatchling got tired…</p>
        <p className="mt-2 text-xl text-zinc-600">Look at the big screen!</p>
      </div>
    );
  }

  const disabled = g.locked || g.phase !== "running";

  return (
    <div className="flex min-h-[75dvh] w-full flex-col gap-3">
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <p className="font-mono">
          Level {g.level + 1}: {g.levelName}
        </p>
        <p aria-label={`${g.lives} lives`}>{"🐢".repeat(Math.max(0, g.lives))}</p>
      </div>

      {g.phase === "level-intro" && (
        <div className="rounded-xl bg-[var(--accent)]/15 px-4 py-3 text-center">
          <p className="text-lg font-black">
            🔀 You have{" "}
            {g.dirs.map((d) => `${DIR_GLYPH[d]} ${DIR_WORD[d]}`).join(" and ")} now!
          </p>
        </div>
      )}

      {g.dirs.map((dir) => (
        <button
          key={dir}
          // pointerdown, not click — every ms counts when a crab is coming.
          onPointerDown={() => {
            if (disabled) return;
            press(dir);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault(); // stop Space from scrolling the page
            if (e.repeat || disabled) return;
            press(dir);
          }}
          aria-disabled={disabled || cooling}
          className={
            "flex flex-1 touch-manipulation select-none flex-col items-center justify-center gap-2 rounded-3xl transition-transform " +
            (disabled
              ? "bg-zinc-200 opacity-50 " +
                (g.phase === "level-intro" ? "animate-pulse ring-4 ring-[var(--accent)]" : "")
              : cooling
                ? "bg-[var(--accent)] text-zinc-950 opacity-60 scale-95"
                : "bg-[var(--accent)] text-zinc-950 active:scale-95 active:brightness-110")
          }
        >
          <span className="text-8xl">{DIR_GLYPH[dir]}</span>
          <span className="text-3xl font-black tracking-widest">{DIR_WORD[dir]}</span>
        </button>
      ))}
    </div>
  );
}

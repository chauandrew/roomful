"use client";
/**
 * Speed 67 — the reference single-device game.
 *
 * Everything runs in this one component on the host's laptop; no room, no
 * realtime. The host drives it with the keyboard (or the on-screen bar):
 *   Space  — advance (show prompt → start 7s countdown → next prompt)
 *   ←  →   — jump between prompts
 *   R      — replay the countdown for the current prompt
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { speed67Meta } from "./meta";
import { PROMPTS } from "./prompts";

const SECONDS = 7;

type Stage = "title" | "prompt" | "counting" | "timeup" | "done";

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("title");
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(SECONDS);
  const deadline = useRef(0);

  useEffect(() => {
    if (stage !== "counting") return;
    deadline.current = performance.now() + SECONDS * 1000;
    let raf: number;
    const tick = () => {
      const left = Math.max(0, (deadline.current - performance.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        setStage("timeup");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, index]);

  const advance = useCallback(() => {
    setStage((cur) => {
      if (cur === "title") return "prompt";
      if (cur === "prompt") return "counting";
      if (cur === "counting") return "timeup"; // skip ahead
      if (cur === "timeup") {
        if (index + 1 >= PROMPTS.length) return "done";
        setIndex((i) => i + 1);
        return "prompt";
      }
      return cur;
    });
  }, [index]);

  const goto = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(PROMPTS.length - 1, i)));
    setStage("prompt");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowRight") goto(index + 1);
      else if (e.key === "ArrowLeft") goto(index - 1);
      else if (e.key.toLowerCase() === "r") setStage("counting");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, goto, index]);

  const pct = remaining / SECONDS;

  return (
    <PresenterLayout
      accent={speed67Meta.accent}
      corner={
        stage !== "title" && stage !== "done" ? (
          <span className="font-mono text-xl text-zinc-500">
            {index + 1} / {PROMPTS.length}
          </span>
        ) : null
      }
    >
      {stage === "title" && (
        <div className="text-center">
          <h1 className="text-8xl font-black tracking-tight text-[var(--accent)]">
            Speed 67
          </h1>
          <p className="mt-6 text-3xl text-zinc-300">
            Shout <strong className="text-white">6</strong> answers in{" "}
            <strong className="text-white">7</strong> seconds.
          </p>
          <p className="mt-12 animate-pulse text-xl text-zinc-500">
            Press Space to start
          </p>
        </div>
      )}

      {(stage === "prompt" || stage === "counting" || stage === "timeup") && (
        <div className="flex flex-col items-center gap-12 text-center">
          <p className="max-w-5xl text-balance text-7xl font-black leading-tight">
            {PROMPTS[index]}
          </p>

          {stage === "prompt" && (
            <p className="animate-pulse text-2xl text-zinc-500">
              Space to start the clock…
            </p>
          )}

          {stage === "counting" && (
            <div className="relative h-48 w-48">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#3f3f46" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${pct * 276.5} 276.5`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-mono text-6xl font-bold">
                {Math.ceil(remaining)}
              </span>
            </div>
          )}

          {stage === "timeup" && (
            <p className="text-6xl font-black text-[var(--accent)]">TIME!</p>
          )}
        </div>
      )}

      <ControlBar>
        <BarButton onClick={() => router.push("/")}>Exit</BarButton>
        <BarButton onClick={() => goto(index - 1)}>← Prev</BarButton>
        <BarButton onClick={() => goto(index + 1)}>Next →</BarButton>
        <BarButton primary onClick={advance}>
          {stage === "prompt" ? "Start timer (Space)" : "Advance (Space)"}
        </BarButton>
      </ControlBar>

      {stage === "done" && (
        <div className="text-center">
          <p className="text-7xl font-black text-[var(--accent)]">That&apos;s all!</p>
          <p className="mt-6 text-2xl text-zinc-400">Thanks for playing Speed 67.</p>
        </div>
      )}
    </PresenterLayout>
  );
}

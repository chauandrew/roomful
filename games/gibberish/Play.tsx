"use client";
/**
 * Gibberish — the reference single-device game.
 *
 * Everything runs in this one component on the host's laptop; no room, no
 * realtime. The screen shows a nonsense phrase, the room says it out loud
 * until someone hears the real phrase, then the host reveals it.
 *
 * Keyboard:
 *   Space  — advance (show puzzle → reveal answer → next puzzle)
 *   ←  →   — jump between puzzles
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { gibberishMeta } from "./meta";
import { PUZZLES } from "./prompts";

type Stage = "title" | "puzzle" | "reveal" | "done";

export default function Play() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("title");
  const [index, setIndex] = useState(0);

  const advance = useCallback(() => {
    // Compute the next stage/index from current values and set them as
    // independent top-level calls (never setIndex nested inside setStage's
    // updater) — React Strict Mode double-invokes updater functions to
    // catch impure side effects, and a nested setIndex call would fire
    // twice per click, skipping a puzzle every time.
    if (stage === "title") {
      setStage("puzzle");
    } else if (stage === "puzzle") {
      setStage("reveal");
    } else if (stage === "reveal") {
      if (index + 1 >= PUZZLES.length) {
        setStage("done");
      } else {
        setIndex(index + 1);
        setStage("puzzle");
      }
    }
  }, [stage, index]);

  const goto = useCallback(
    (i: number) => {
      // Once finished, arrow keys/buttons must stay inert — otherwise a
      // stray keypress after the last puzzle drops the host back into
      // gameplay instead of staying on the end screen.
      if (stage === "done") return;
      setIndex(Math.max(0, Math.min(PUZZLES.length - 1, i)));
      setStage("puzzle");
    },
    [stage]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowRight") goto(index + 1);
      else if (e.key === "ArrowLeft") goto(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, goto, index]);

  const puzzle = PUZZLES[index];

  return (
    <PresenterLayout
      accent={gibberishMeta.accent}
      corner={
        stage === "puzzle" || stage === "reveal" ? (
          <span className="font-mono text-xl text-zinc-500">
            {index + 1} / {PUZZLES.length}
          </span>
        ) : null
      }
    >
      {stage === "title" && (
        <div className="text-center">
          <h1 className="text-8xl font-black tracking-tight text-[var(--accent)]">
            Gibberish
          </h1>
          <p className="mt-6 text-3xl text-zinc-700">
            Say it out loud until you hear the real phrase.
          </p>
          <p className="mt-12 animate-pulse text-xl text-zinc-500">
            Press Space to start
          </p>
        </div>
      )}

      {(stage === "puzzle" || stage === "reveal") && (
        <div className="flex flex-col items-center gap-12 text-center">
          <p className="max-w-5xl text-balance text-7xl font-black leading-tight">
            “{puzzle.gibberish}”
          </p>
          {stage === "puzzle" ? (
            <p className="animate-pulse text-2xl text-zinc-500">
              Say it out loud… Space to reveal
            </p>
          ) : (
            <p className="max-w-5xl text-balance text-6xl font-black text-[var(--accent)]">
              {puzzle.answer}
            </p>
          )}
        </div>
      )}

      {stage === "done" && (
        <div className="text-center">
          <p className="text-7xl font-black text-[var(--accent)]">That&apos;s all!</p>
          <p className="mt-6 text-2xl text-zinc-600">Thanks for playing Gibberish.</p>
        </div>
      )}

      <ControlBar>
        <BarButton onClick={() => router.push("/")}>Exit</BarButton>
        {stage !== "done" && (
          <>
            <BarButton onClick={() => goto(index - 1)}>← Prev</BarButton>
            <BarButton onClick={() => goto(index + 1)}>Next →</BarButton>
            <BarButton primary onClick={advance}>
              {stage === "puzzle" ? "Reveal (Space)" : "Advance (Space)"}
            </BarButton>
          </>
        )}
      </ControlBar>
    </PresenterLayout>
  );
}

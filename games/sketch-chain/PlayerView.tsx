"use client";
/**
 * Sketch Chain — phone screen. Depending on the step you either write a
 * phrase (TextInput), draw one (DrawingCanvas), or describe a drawing
 * (TextInput again). Your prompt is private — that's the whole game.
 */
import { DrawingCanvas } from "@/components/inputs/DrawingCanvas";
import { TextInput } from "@/components/inputs/TextInput";
import type { PlayerViewProps } from "@/games/clientTypes";

type SCPlayerViewData =
  | { phase: "reveal" }
  | { phase: "waiting"; waitingOn: number }
  | {
      phase: "working";
      step: number;
      totalSteps: number;
      task: "write" | "draw" | "describe";
      prompt: { kind: "text" | "drawing"; value: string; authorName: string } | null;
    };

export default function PlayerView({ view, sendInput }: PlayerViewProps) {
  const g = view.game as SCPlayerViewData;

  if (g.phase === "reveal") {
    return (
      <div className="text-center">
        <p className="text-5xl">👀</p>
        <p className="mt-4 text-2xl font-bold">Look at the big screen!</p>
      </div>
    );
  }

  if (g.phase === "waiting") {
    return (
      <div className="text-center">
        <p className="text-5xl">✅</p>
        <p className="mt-4 text-2xl font-bold">Handed in!</p>
        <p className="mt-2 text-zinc-600">
          Waiting on {g.waitingOn} more player{g.waitingOn === 1 ? "" : "s"}…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="mb-1 font-mono text-sm text-zinc-500">
        Round {g.step + 1} / {g.totalSteps}
      </p>

      {g.task === "write" && (
        <>
          <h2 className="mb-4 text-2xl font-bold">Write a weird phrase</h2>
          <p className="mb-4 text-zinc-600">
            Someone else will have to draw this. Make it count.
          </p>
          <TextInput
            placeholder="e.g. a raccoon giving a TED talk"
            onSubmit={(value) => sendInput({ value })}
          />
        </>
      )}

      {g.task === "draw" && g.prompt && (
        <>
          <h2 className="mb-2 text-2xl font-bold">Draw this:</h2>
          <p className="mb-4 rounded-xl bg-zinc-100 px-4 py-3 text-xl font-semibold text-[var(--accent)]">
            “{g.prompt.value}”
          </p>
          <DrawingCanvas onSubmit={(value) => sendInput({ value })} />
        </>
      )}

      {g.task === "describe" && g.prompt && (
        <>
          <h2 className="mb-2 text-2xl font-bold">What is this?</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={g.prompt.value}
            alt={`Drawing by ${g.prompt.authorName}`}
            className="mb-4 w-full rounded-xl bg-white"
          />
          <TextInput
            placeholder="Describe the drawing…"
            onSubmit={(value) => sendInput({ value })}
          />
        </>
      )}
    </div>
  );
}

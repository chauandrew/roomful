"use client";
/**
 * Sketch Chain — projector screen. During "working" it shows progress and
 * who's still scribbling; during "reveal" the host steps through each chain
 * entry by entry.
 */
import { BarButton, ControlBar } from "@/components/PresenterLayout";
import type { HostViewProps } from "@/games/clientTypes";

type SCHostViewData =
  | {
      phase: "working";
      step: number;
      totalSteps: number;
      task: "write" | "draw" | "describe";
      submittedCount: number;
      playerCount: number;
      waitingOn: string[];
    }
  | {
      phase: "reveal";
      chainIndex: number;
      chainCount: number;
      startedBy: string;
      entries: { kind: "text" | "drawing"; value: string; authorName: string }[];
      chainComplete: boolean;
      allDone: boolean;
    };

const TASK_LABEL = {
  write: "Everyone: write a weird phrase on your phone",
  draw: "Everyone: draw the phrase you were handed",
  describe: "Everyone: describe the drawing you were handed",
};

export default function HostView({ view, sendGameAction, sendHostAction }: HostViewProps) {
  const g = view.game as SCHostViewData;

  if (g.phase === "working") {
    return (
      <div className="flex w-full flex-col items-center text-center">
        <p className="mb-2 font-mono text-xl text-zinc-500">
          Round {g.step + 1} / {g.totalSteps}
        </p>
        <h2 className="max-w-4xl text-balance text-6xl font-black leading-tight">
          {TASK_LABEL[g.task]}
        </h2>
        <p className="mt-12 text-3xl text-zinc-600">
          <span className="font-black text-[var(--accent)]">{g.submittedCount}</span>
          {" of "}
          <span className="font-bold text-zinc-900">{g.playerCount}</span> handed in
        </p>
        {g.waitingOn.length > 0 && g.waitingOn.length <= 6 && (
          <p className="mt-4 text-xl text-zinc-500">
            Waiting on {g.waitingOn.join(", ")}…
          </p>
        )}
        <ControlBar>
          <BarButton onClick={() => sendHostAction({ kind: "end" })}>End</BarButton>
          <BarButton onClick={() => sendGameAction({ type: "force-advance" })}>
            Skip stragglers
          </BarButton>
        </ControlBar>
      </div>
    );
  }

  if (g.allDone) {
    return (
      <div className="text-center">
        <p className="text-7xl font-black text-[var(--accent)]">That&apos;s every chain!</p>
        <ControlBar>
          <BarButton onClick={() => sendHostAction({ kind: "restart" })}>
            Back to lobby
          </BarButton>
          <BarButton primary onClick={() => sendHostAction({ kind: "end" })}>
            End game
          </BarButton>
        </ControlBar>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full max-w-5xl flex-col items-center">
      <p className="mb-6 font-mono text-xl text-zinc-500">
        Chain {g.chainIndex + 1} / {g.chainCount} — started by{" "}
        <span className="text-[var(--accent)]">{g.startedBy}</span>
      </p>
      <div className="flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto pb-16">
        {g.entries.map((e, i) => (
          <div key={i} className="w-full max-w-3xl">
            <p className="mb-1 text-sm text-zinc-500">{e.authorName}</p>
            {e.kind === "text" ? (
              <p className="rounded-xl bg-zinc-100 px-6 py-4 text-3xl font-bold">
                “{e.value}”
              </p>
            ) : e.value ? (
              // Drawings travel as PNG data URLs, so a plain <img> renders them.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={e.value}
                alt={`Drawing by ${e.authorName}`}
                className="max-h-96 rounded-xl bg-white"
              />
            ) : (
              <p className="rounded-xl bg-zinc-100 px-6 py-4 text-2xl italic text-zinc-500">
                (no drawing)
              </p>
            )}
          </div>
        ))}
      </div>
      <ControlBar>
        <BarButton onClick={() => sendHostAction({ kind: "end" })}>End</BarButton>
        <BarButton primary onClick={() => sendGameAction({ type: "advance-reveal" })}>
          {g.chainComplete ? "Next chain" : "Reveal next"}
        </BarButton>
      </ControlBar>
    </div>
  );
}

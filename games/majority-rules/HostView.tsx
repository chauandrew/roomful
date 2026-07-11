"use client";
/** Majority Rules — projector screen. Live tally bars, reveal, leaderboard. */
import { BarButton, ControlBar } from "@/components/PresenterLayout";
import type { HostViewProps } from "@/games/clientTypes";

interface MRHostView {
  phase: "answering" | "revealed" | "final";
  qIndex: number;
  qTotal: number;
  prompt: string;
  options: { id: string; label: string; count: number }[];
  answeredCount: number;
  playerCount: number;
  majority: string[];
  leaderboard: { name: string; score: number }[];
}

export default function HostView({ view, sendGameAction, sendHostAction }: HostViewProps) {
  const g = view.game as MRHostView;
  const maxCount = Math.max(1, ...g.options.map((o) => o.count));

  if (g.phase === "final") {
    return (
      <div className="flex w-full flex-col items-center">
        <h2 className="mb-10 text-6xl font-black text-[var(--accent)]">Final scores</h2>
        <ol className="w-full max-w-2xl space-y-3">
          {g.leaderboard.slice(0, 8).map((row, i) => (
            <li
              key={row.name + i}
              className="flex items-baseline justify-between rounded-xl bg-zinc-900 px-6 py-4"
            >
              <span className="text-3xl font-bold">
                <span className="mr-4 text-zinc-500">{i + 1}</span>
                {row.name}
              </span>
              <span className="text-3xl font-black text-[var(--accent)]">{row.score}</span>
            </li>
          ))}
        </ol>
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
    <div className="flex w-full flex-col items-center">
      <p className="mb-2 font-mono text-xl text-zinc-500">
        Question {g.qIndex + 1} / {g.qTotal}
      </p>
      <h2 className="mb-12 max-w-5xl text-balance text-center text-6xl font-black leading-tight">
        {g.prompt}
      </h2>

      <div className="w-full max-w-3xl space-y-4">
        {g.options.map((opt) => {
          const highlight = g.phase === "revealed" && g.majority.includes(opt.id);
          return (
            <div key={opt.id} className="relative overflow-hidden rounded-xl bg-zinc-900">
              <div
                className={
                  "absolute inset-y-0 left-0 transition-all duration-500 " +
                  (highlight ? "bg-[var(--accent)]" : "bg-zinc-700")
                }
                style={{ width: `${(opt.count / maxCount) * 100}%` }}
              />
              <div className="relative flex items-center justify-between px-6 py-4">
                <span className={"text-2xl font-bold " + (highlight ? "text-zinc-950" : "")}>
                  {opt.label}
                </span>
                <span
                  className={
                    "font-mono text-2xl font-black " +
                    (highlight ? "text-zinc-950" : "text-zinc-400")
                  }
                >
                  {opt.count}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-10 text-2xl text-zinc-500">
        {g.phase === "answering"
          ? `${g.answeredCount} of ${g.playerCount} answered…`
          : "Majority takes the point!"}
      </p>

      <ControlBar>
        <BarButton onClick={() => sendHostAction({ kind: "end" })}>End</BarButton>
        {g.phase === "answering" ? (
          <BarButton primary onClick={() => sendGameAction({ type: "reveal" })}>
            Reveal ({g.answeredCount}/{g.playerCount})
          </BarButton>
        ) : (
          <BarButton primary onClick={() => sendGameAction({ type: "next" })}>
            {g.qIndex + 1 >= g.qTotal ? "Final scores" : "Next question"}
          </BarButton>
        )}
      </ControlBar>
    </div>
  );
}

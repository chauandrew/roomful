"use client";
/** Majority Rules — phone screen. Pick an option, see if you sided with the room. */
import { ChoiceInput } from "@/components/inputs/ChoiceInput";
import type { PlayerViewProps } from "@/games/clientTypes";

interface MRPlayerView {
  phase: "answering" | "revealed" | "final";
  prompt: string;
  options: { id: string; label: string }[];
  yourAnswer: string | null;
  inMajority: boolean;
  yourScore: number;
  leaderboard: { name: string; score: number }[] | null;
}

export default function PlayerView({ view, sendInput }: PlayerViewProps) {
  const g = view.game as MRPlayerView;

  if (g.phase === "final") {
    return (
      <div className="text-center">
        <p className="text-lg text-zinc-600">Final score</p>
        <p className="my-4 text-7xl font-black text-[var(--accent)]">{g.yourScore}</p>
        <ol className="mt-6 space-y-1 text-left">
          {g.leaderboard?.slice(0, 5).map((row, i) => (
            <li key={row.name + i} className="flex justify-between text-zinc-700">
              <span>
                {i + 1}. {row.name}
              </span>
              <span className="font-bold">{row.score}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (g.phase === "revealed") {
    return (
      <div className="text-center">
        <p className="text-5xl">{g.inMajority ? "🎉" : "🙃"}</p>
        <p className="mt-4 text-2xl font-bold">
          {g.inMajority ? "You sided with the majority! +1" : "Against the grain…"}
        </p>
        <p className="mt-2 text-zinc-600">
          Score: <span className="font-bold text-zinc-900">{g.yourScore}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h2 className="mb-6 text-balance text-2xl font-bold">{g.prompt}</h2>
      <ChoiceInput
        options={g.options}
        onSubmit={([optionId]) => sendInput({ optionId })}
      />
      {g.yourAnswer && (
        <p className="mt-4 text-center text-sm text-zinc-500">
          Answered! Tap another option to change your mind before the reveal.
        </p>
      )}
    </div>
  );
}

import { games } from "@/games/registry";
import { GameGrid } from "@/components/GameGrid";
import { JoinCodeForm } from "@/components/JoinCodeForm";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="mb-12 text-center">
        <h1 className="text-6xl font-black tracking-tight">
          Room<span className="text-amber-600">ful</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-zinc-600">
          Party games for a room full of people. Put this on the big screen —
          some games play right there, others pull everyone in on their phones.
        </p>
        <div className="mx-auto mt-8 max-w-xs">
          <JoinCodeForm />
        </div>
      </header>
      <GameGrid games={games} />
    </main>
  );
}

"use client";
/** Homepage game cards with a single-device / multi-user filter. */
import { useState } from "react";
import Link from "next/link";
import type { GameMeta, GameMode } from "@/lib/types";

type Filter = "all" | GameMode;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All games" },
  { id: "single-device", label: "Big screen only" },
  { id: "multi-user", label: "Phones join in" },
];

export function GameGrid({ games }: { games: GameMeta[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = games.filter((g) => filter === "all" || g.mode === filter);

  return (
    <section>
      <div className="mb-6 flex justify-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors " +
              (filter === f.id
                ? "bg-zinc-900 text-white"
                : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((game) => (
          <Link
            key={game.id}
            href={game.mode === "single-device" ? `/play/${game.id}` : `/host/${game.id}`}
            className="group flex flex-col rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-[var(--card-accent)]"
            style={{ "--card-accent": game.accent } as React.CSSProperties}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-2xl font-black" style={{ color: game.accent }}>
                {game.name}
              </h2>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                {game.mode === "single-device" ? "📺 Big screen" : "📱 Phones"}
              </span>
            </div>
            <p className="flex-1 text-sm leading-relaxed text-zinc-600">
              {game.description}
            </p>
            <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
              <span>
                {game.mode === "single-device"
                  ? "Any crowd size"
                  : `${game.minPlayers}–${game.maxPlayers} players`}
              </span>
              <span>~{game.durationMinutes} min</span>
            </div>
            <span className="mt-4 text-sm font-bold text-zinc-700 group-hover:text-[var(--card-accent)]">
              {game.mode === "single-device" ? "Play →" : "Host a room →"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

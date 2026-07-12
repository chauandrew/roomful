"use client";
/**
 * The projected lobby every multi-user game gets for free: giant room code,
 * QR code, live player list, start button. Games never implement this.
 */
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { BarButton, ControlBar } from "@/components/PresenterLayout";
import type { GameMeta, ClientView } from "@/lib/types";
import type { HostAction } from "@/lib/protocol";

export function HostLobby({
  meta,
  view,
  sendHostAction,
}: {
  meta: GameMeta;
  view: ClientView;
  sendHostAction: (action: HostAction) => void;
}) {
  const router = useRouter();
  // This component only ever renders after a websocket sync arrives, so it
  // never runs during SSR — reading window directly is safe here.
  const joinUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/join/${view.code}`;

  const connectedCount = view.players.filter((p) => p.connected).length;
  const canStart = connectedCount >= meta.minPlayers;

  return (
    <div className="flex w-full max-w-6xl flex-col items-center gap-10">
      <h1 className="text-5xl font-black text-[var(--accent)]">{meta.name}</h1>

      <div className="flex items-center gap-14">
        <div className="rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-sm">
          {joinUrl && <QRCode value={joinUrl} size={220} />}
        </div>
        <div className="text-left">
          <p className="text-2xl text-zinc-600">Join on your phone</p>
          <p className="mt-1 text-3xl font-bold">{joinUrl.replace(/^https?:\/\//, "")}</p>
          <p className="mt-6 text-2xl text-zinc-600">Room code</p>
          <p className="font-mono text-8xl font-black tracking-[0.15em] text-[var(--accent)]">
            {view.code}
          </p>
        </div>
      </div>

      <div className="flex min-h-12 max-w-4xl flex-wrap items-center justify-center gap-3">
        {view.players.length === 0 && (
          <p className="animate-pulse text-xl text-zinc-500">Waiting for players…</p>
        )}
        {view.players.map((p) => (
          <span
            key={p.id}
            className={
              "group rounded-full px-5 py-2 text-xl font-bold " +
              (p.connected ? "bg-zinc-200" : "bg-zinc-100 text-zinc-400 line-through")
            }
          >
            {p.name}
            <button
              aria-label={`Remove ${p.name}`}
              onClick={() => sendHostAction({ kind: "kick", playerId: p.id })}
              className="ml-2 hidden text-zinc-500 hover:text-red-400 group-hover:inline"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <button
        onClick={() => sendHostAction({ kind: "start" })}
        disabled={!canStart}
        className="rounded-2xl bg-[var(--accent)] px-12 py-5 text-3xl font-black text-zinc-950 transition-transform hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
      >
        {canStart
          ? `Start with ${connectedCount} player${connectedCount === 1 ? "" : "s"}`
          : `Need ${meta.minPlayers - connectedCount} more player${
              meta.minPlayers - connectedCount === 1 ? "" : "s"
            }`}
      </button>

      <ControlBar>
        <BarButton onClick={() => router.push("/")}>Exit</BarButton>
      </ControlBar>
    </div>
  );
}

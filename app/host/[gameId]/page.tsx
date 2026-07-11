"use client";
/**
 * /host/[gameId] — the projector view for multi-user games.
 *
 * The platform owns everything except the "playing" phase: it generates the
 * room code (kept in the URL so a refresh rejoins the same room), renders
 * the lobby with QR + player list, and the end screen. The game's HostView
 * only ever renders mid-game.
 */
import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getGameMeta } from "@/games/registry";
import { gameComponents } from "@/games/clientRegistry";
import { generateRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { useRoom } from "@/hooks/useRoom";
import { PresenterLayout, ControlBar, BarButton } from "@/components/PresenterLayout";
import { HostLobby } from "@/components/HostLobby";
import type { GameMeta } from "@/lib/types";

export default function HostPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense>
      <HostPageInner />
    </Suspense>
  );
}

function HostPageInner() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const meta = getGameMeta(gameId);
  const code = useSearchParams().get("code")?.toUpperCase() ?? null;

  // Put the room code in the URL so refreshing the host tab reclaims the
  // same room (the hostKey for it lives in sessionStorage).
  useEffect(() => {
    if (meta && (!code || !isValidRoomCode(code))) {
      router.replace(`/host/${gameId}?code=${generateRoomCode()}`);
    }
  }, [meta, code, gameId, router]);

  if (!meta || meta.mode !== "multi-user") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-2xl font-bold">No multi-user game called “{gameId}”.</p>
        <Link href="/" className="text-amber-600 underline">
          Back to all games
        </Link>
      </main>
    );
  }
  if (!code || !isValidRoomCode(code)) return null; // redirecting

  return <HostRoom meta={meta} code={code} />;
}

function HostRoom({ meta, code }: { meta: GameMeta; code: string }) {
  const router = useRouter();
  const { view, error, connected, sendHostAction, sendGameAction } = useRoom({
    code,
    role: "host",
    gameId: meta.id,
  });
  const HostView = gameComponents[meta.id]?.HostView;

  return (
    <PresenterLayout
      accent={meta.accent}
      corner={
        view?.phase === "playing" ? (
          <span className="font-mono text-xl tracking-widest text-zinc-600">{code}</span>
        ) : null
      }
    >
      {error?.code === "room-taken" ? (
        <div className="text-center">
          <p className="text-3xl font-bold">Room {code} is already in use.</p>
          <button
            onClick={() => router.replace(`/host/${meta.id}?code=${generateRoomCode()}`)}
            className="mt-6 rounded-xl bg-[var(--accent)] px-6 py-3 text-xl font-bold text-zinc-950"
          >
            Get a new room
          </button>
        </div>
      ) : error ? (
        <p className="text-2xl text-red-600">{error.message}</p>
      ) : !view ? (
        <p className="animate-pulse text-2xl text-zinc-500">
          {connected ? "Setting up the room…" : "Connecting…"}
        </p>
      ) : view.phase === "lobby" ? (
        <HostLobby meta={meta} view={view} sendHostAction={sendHostAction} />
      ) : view.phase === "playing" && HostView ? (
        <HostView view={view} sendGameAction={sendGameAction} sendHostAction={sendHostAction} />
      ) : (
        <div className="text-center">
          <p className="text-6xl font-black text-[var(--accent)]">Thanks for playing!</p>
          <ControlBar>
            <BarButton onClick={() => router.push("/")}>Exit</BarButton>
            <BarButton primary onClick={() => sendHostAction({ kind: "restart" })}>
              Play again
            </BarButton>
          </ControlBar>
        </div>
      )}
    </PresenterLayout>
  );
}

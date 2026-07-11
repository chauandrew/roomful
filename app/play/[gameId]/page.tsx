"use client";
/**
 * /play/[gameId] — single-device games. The game component owns the whole
 * screen; there's no room, no realtime, no join flow.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { getGameMeta } from "@/games/registry";
import { gameComponents } from "@/games/clientRegistry";

export default function PlayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const meta = getGameMeta(gameId);
  const Play = gameComponents[gameId]?.Play;

  if (!meta || meta.mode !== "single-device" || !Play) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-2xl font-bold">No single-device game called “{gameId}”.</p>
        <Link href="/" className="text-amber-600 underline">
          Back to all games
        </Link>
      </main>
    );
  }

  return <Play />;
}

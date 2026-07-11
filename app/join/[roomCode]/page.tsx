"use client";
/**
 * /join/[roomCode] — the player view, designed for phones.
 *
 * The platform owns the join flow (name form), the waiting lobby, and the
 * end screen; the game's PlayerView only renders during the "playing" phase.
 */
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getGameMeta } from "@/games/registry";
import { gameComponents } from "@/games/clientRegistry";
import { normalizeRoomCode, isValidRoomCode } from "@/lib/roomCode";
import { useRoom } from "@/hooks/useRoom";

export default function JoinPage() {
  const params = useParams<{ roomCode: string }>();
  const code = normalizeRoomCode(params.roomCode ?? "");

  if (!isValidRoomCode(code)) {
    return (
      <Shell accent="#fbbf24">
        <Message emoji="🤔" title="That's not a room code.">
          <Link href="/" className="text-[var(--accent)] underline">
            Go home and try again
          </Link>
        </Message>
      </Shell>
    );
  }
  return <PlayerRoom code={code} />;
}

function PlayerRoom({ code }: { code: string }) {
  const { view, error, join, hasJoined, sendInput, connected } = useRoom({
    code,
    role: "player",
  });
  const meta = view ? getGameMeta(view.gameId) : undefined;
  const accent = meta?.accent ?? "#fbbf24";
  const PlayerView = view ? gameComponents[view.gameId]?.PlayerView : undefined;

  let content: React.ReactNode;
  if (error) {
    content = (
      <Message emoji="😵" title={error.message}>
        <Link href="/" className="text-[var(--accent)] underline">
          Back to Roomful
        </Link>
      </Message>
    );
  } else if (!view) {
    content = hasJoined ? (
      <p className="animate-pulse text-center text-xl text-zinc-500">
        {connected ? "Rejoining…" : "Connecting…"}
      </p>
    ) : (
      <NameForm onJoin={join} code={code} />
    );
  } else if (view.phase === "lobby") {
    content = (
      <Message emoji="🎉" title={`You're in, ${view.you?.name}!`}>
        <p className="text-zinc-400">
          {view.players.length} player{view.players.length === 1 ? "" : "s"} in the
          room. Watch the big screen — the host starts the game.
        </p>
      </Message>
    );
  } else if (view.phase === "playing" && PlayerView) {
    content = <PlayerView view={view} sendInput={sendInput} />;
  } else {
    content = (
      <Message emoji="👋" title="Thanks for playing!">
        <Link href="/" className="text-[var(--accent)] underline">
          Back to Roomful
        </Link>
      </Message>
    );
  }

  return (
    <Shell accent={accent} header={view ? `${meta?.name ?? ""} · ${code}` : code}>
      {content}
      {view && !connected && (
        <p className="mt-6 animate-pulse text-center text-sm text-amber-400">
          Reconnecting…
        </p>
      )}
    </Shell>
  );
}

function Shell({
  accent,
  header,
  children,
}: {
  accent: string;
  header?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-4"
      style={{ "--accent": accent } as CSSProperties}
    >
      <p className="mb-8 text-center font-mono text-sm tracking-widest text-zinc-500">
        {header ?? "ROOMFUL"}
      </p>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </main>
  );
}

function Message({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <p className="text-5xl">{emoji}</p>
      <p className="mt-4 text-2xl font-bold">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function NameForm({ onJoin, code }: { onJoin: (name: string) => void; code: string }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onJoin(trimmed);
      }}
    >
      <h1 className="text-center text-3xl font-black">
        Joining room <span className="text-[var(--accent)]">{code}</span>
      </h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={20}
        autoFocus
        autoComplete="off"
        className="rounded-xl border-2 border-zinc-700 bg-zinc-800 px-4 py-4 text-center text-xl font-bold placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={!trimmed}
        className="min-h-14 rounded-xl bg-[var(--accent)] text-xl font-black text-zinc-950 disabled:opacity-40"
      >
        Jump in
      </button>
    </form>
  );
}

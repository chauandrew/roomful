"use client";
/** "Have a room code?" quick-join box on the homepage, for phones landing on /. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "@/lib/roomCode";

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === ROOM_CODE_LENGTH) router.push(`/join/${code}`);
      }}
    >
      <input
        value={code}
        onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
        placeholder="ROOM CODE"
        maxLength={ROOM_CODE_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        className="w-full rounded-xl border-2 border-zinc-700 bg-zinc-900 px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.3em] placeholder:tracking-normal placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={code.length !== ROOM_CODE_LENGTH}
        className="rounded-xl bg-amber-400 px-5 font-bold text-zinc-950 disabled:opacity-40"
      >
        Join
      </button>
    </form>
  );
}

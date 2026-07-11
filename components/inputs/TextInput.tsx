"use client";
/** Free-text input for player phones. */
import { useState } from "react";

export function TextInput({
  placeholder = "Type your answer…",
  maxLength = 120,
  buttonLabel = "Submit",
  onSubmit,
  disabled = false,
}: {
  placeholder?: string;
  maxLength?: number;
  buttonLabel?: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        disabled={disabled}
        className="w-full rounded-xl border-2 border-zinc-700 bg-zinc-800 p-4 text-lg text-white placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !trimmed}
        className="min-h-14 rounded-xl bg-[var(--accent)] px-4 text-lg font-bold text-zinc-950 disabled:opacity-40"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

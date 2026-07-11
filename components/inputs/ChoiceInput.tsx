"use client";
/**
 * Single- or multi-choice input for player phones. Big tap targets.
 * Submits option id(s) via onSubmit.
 */
import { useState } from "react";

export interface ChoiceOption {
  id: string;
  label: string;
}

export function ChoiceInput({
  options,
  multi = false,
  onSubmit,
  disabled = false,
}: {
  options: ChoiceOption[];
  multi?: boolean;
  onSubmit: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function tap(id: string) {
    if (disabled) return;
    if (!multi) {
      // Single choice submits immediately — one tap, no confirm step.
      onSubmit([id]);
      return;
    }
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            onClick={() => tap(opt.id)}
            disabled={disabled}
            className={
              "min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg font-semibold transition-colors disabled:opacity-50 " +
              (isSelected
                ? "border-[var(--accent)] bg-[var(--accent)] text-zinc-950"
                : "border-zinc-700 bg-zinc-800 text-white active:border-[var(--accent)]")
            }
          >
            {opt.label}
          </button>
        );
      })}
      {multi && (
        <button
          onClick={() => onSubmit(selected)}
          disabled={disabled || selected.length === 0}
          className="min-h-14 rounded-xl bg-[var(--accent)] px-4 text-lg font-bold text-zinc-950 disabled:opacity-40"
        >
          Submit
        </button>
      )}
    </div>
  );
}

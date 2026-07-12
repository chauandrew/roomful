"use client";
import { useEffect, useRef, useState } from "react";

interface CameraCheckProps {
  /** Whether the required landmarks are currently tracked (see signals.ts's isVisible). */
  isVisible: boolean;
  /** Continuous tracking required, in ms, before Ready enables. */
  stabilityMs: number;
  onReady: () => void;
  onBack: () => void;
  /** Shown while nothing is tracked yet. Defaults to floss-rush's body-pose copy. */
  notVisibleLabel?: string;
  /** Subject used in the two "tracked" states, e.g. "Body detected" / "Face detected". */
  visibleLabel?: string;
}

/**
 * Shared "step back, hold still, Ready" gating screen. Ready only enables
 * after `isVisible` has held continuously for `stabilityMs` (one lucky frame
 * isn't enough), and re-disables the moment tracking drops — same rule
 * floss-rush uses so "ready" here can never disagree with in-game counting.
 */
export function CameraCheck({
  isVisible,
  stabilityMs,
  onReady,
  onBack,
  notVisibleLabel = "Step back — get your arms & hips in frame",
  visibleLabel = "Body detected",
}: CameraCheckProps) {
  const readySinceRef = useRef<number | null>(null);
  const [stable, setStable] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      readySinceRef.current = null;
      // Deferred (not called synchronously in the effect body) to avoid
      // triggering a cascading render on every prop change.
      const timeout = setTimeout(() => setStable(false), 0);
      return () => clearTimeout(timeout);
    }
    if (readySinceRef.current === null) readySinceRef.current = performance.now();
    const elapsed = performance.now() - readySinceRef.current;
    const timeout = setTimeout(() => setStable(true), Math.max(0, stabilityMs - elapsed));
    return () => clearTimeout(timeout);
  }, [isVisible, stabilityMs]);

  // Belt-and-suspenders: gate on both, so a stale `stable` from the previous
  // visible period can never enable Ready during the deferred reset above.
  const gated = isVisible && stable;

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <p
        className={
          "text-3xl font-bold " + (isVisible ? "text-[var(--accent)]" : "text-zinc-500")
        }
      >
        {!isVisible ? notVisibleLabel : gated ? `${visibleLabel} — you're good to go!` : `${visibleLabel} — hold on…`}
      </p>
      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="rounded-md bg-zinc-200 px-6 py-3 text-lg font-medium text-zinc-700 hover:bg-zinc-300"
        >
          Back
        </button>
        <button
          onClick={onReady}
          disabled={!gated}
          className="rounded-md bg-[var(--accent)] px-6 py-3 text-lg font-medium text-zinc-950 transition-opacity hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ready
        </button>
      </div>
    </div>
  );
}

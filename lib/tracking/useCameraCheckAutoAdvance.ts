"use client";
import { useCallback, useEffect, useRef } from "react";

interface UseCameraCheckAutoAdvanceOptions {
  /** Continuous visibility required, in ms, before onReady fires. */
  stabilityMs: number;
  /** Called once, the moment a `check(true)` streak reaches stabilityMs. */
  onReady: () => void;
}

/**
 * Tracks how long CAMERA_CHECK has seen the player continuously, so a game
 * can start the round itself instead of waiting on a manual "Ready" click.
 * Call `check(visible)` on every tracking frame while in CAMERA_CHECK, and
 * `reset()` whenever leaving that stage (entering it fresh, or aborting back
 * to idle) so a later re-entry doesn't inherit a stale streak.
 */
export function useCameraCheckAutoAdvance({ stabilityMs, onReady }: UseCameraCheckAutoAdvanceOptions) {
  const stableSinceRef = useRef<number | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const check = useCallback(
    (visible: boolean) => {
      if (!visible) {
        stableSinceRef.current = null;
      } else if (stableSinceRef.current === null) {
        stableSinceRef.current = performance.now();
      } else if (performance.now() - stableSinceRef.current >= stabilityMs) {
        stableSinceRef.current = null;
        onReadyRef.current();
      }
    },
    [stabilityMs]
  );

  const reset = useCallback(() => {
    stableSinceRef.current = null;
  }, []);

  return { check, reset };
}

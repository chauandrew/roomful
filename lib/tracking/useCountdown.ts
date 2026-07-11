"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseCountdownOptions {
  /** Starting number, e.g. 3 counts down 3, 2, 1. */
  from: number;
  /** Delay between each number. */
  tickMs: number;
  /** How long the "go" label stays up before onDone fires. */
  goMs: number;
  /** Label shown after the numbers reach zero. Defaults to "GO!". */
  goLabel?: string;
  /** Called once, after the "go" label's delay elapses. */
  onDone: () => void;
}

/** Generic, cancelable N -> 0 -> "GO" countdown. */
export function useCountdown({ from, tickMs, goMs, goLabel = "GO!", onDone }: UseCountdownOptions) {
  const [label, setLabel] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setLabel(null);
  }, []);

  const start = useCallback(() => {
    let n = from;
    const tick = () => {
      if (n > 0) {
        setLabel(String(n));
        n -= 1;
        timeoutRef.current = setTimeout(tick, tickMs);
      } else {
        setLabel(goLabel);
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          setLabel(null);
          onDoneRef.current();
        }, goMs);
      }
    };
    tick();
  }, [from, tickMs, goMs, goLabel]);

  useEffect(() => () => cancel(), [cancel]);

  return { label, active: label !== null, start, cancel };
}

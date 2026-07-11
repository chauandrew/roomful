"use client";
/**
 * Freehand drawing input for player phones. Pointer-events based (works
 * with finger, stylus, and mouse), with a small color palette, undo, and
 * clear. Submits the drawing as a PNG data URL — small enough (~10–60 KB)
 * to travel over the room's websocket and render anywhere as an <img>.
 */
import { useEffect, useRef, useState } from "react";

// Fixed internal resolution; CSS scales it responsively. 4:3 reads well on
// both phones (input) and projectors (display).
const W = 640;
const H = 480;

const COLORS = ["#18181b", "#dc2626", "#2563eb", "#16a34a", "#ca8a04", "#9333ea"];

interface Stroke {
  color: string;
  points: { x: number; y: number }[];
}

export function DrawingCanvas({
  onSubmit,
  buttonLabel = "Submit drawing",
  disabled = false,
}: {
  onSubmit: (pngDataUrl: string) => void;
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const drawing = useRef<Stroke | null>(null);

  function redraw() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const s of all) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  useEffect(redraw, [strokes]);

  function canvasPoint(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full touch-none rounded-xl border-2 border-zinc-700 bg-white"
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = { color, points: [canvasPoint(e)] };
          redraw();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          drawing.current.points.push(canvasPoint(e));
          redraw();
        }}
        onPointerUp={() => {
          // Capture before clearing: the setStrokes updater runs later,
          // after drawing.current has already been nulled.
          const finished = drawing.current;
          if (!finished) return;
          drawing.current = null;
          setStrokes((cur) => [...cur, finished]);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Draw in ${c}`}
              onClick={() => setColor(c)}
              className={
                "h-9 w-9 rounded-full border-2 " +
                (c === color ? "border-[var(--accent)] scale-110" : "border-zinc-600")
              }
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStrokes((cur) => cur.slice(0, -1))}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300"
          >
            Undo
          </button>
          <button
            onClick={() => setStrokes([])}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300"
          >
            Clear
          </button>
        </div>
      </div>
      <button
        onClick={() => {
          redraw(); // make sure the bitmap matches state before export
          onSubmit(canvasRef.current!.toDataURL("image/png"));
        }}
        disabled={disabled || strokes.length === 0}
        className="min-h-14 rounded-xl bg-[var(--accent)] px-4 text-lg font-bold text-zinc-950 disabled:opacity-40"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

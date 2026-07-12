"use client";
/**
 * Shared shell for every host-facing (projected) screen: fullscreen,
 * large type, one accent color per game (exposed as the --accent CSS var),
 * and a small control bar that stays out of the way of the projection.
 */
import type { CSSProperties, ReactNode } from "react";

export function PresenterLayout({
  accent,
  children,
  corner,
}: {
  /** Game accent color (hex). Available to children as var(--accent). */
  accent: string;
  children: ReactNode;
  /** Optional persistent corner info, e.g. the room code — top-right. */
  corner?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      style={{ "--accent": accent } as CSSProperties}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
        {children}
      </div>
      {corner && (
        <div className="absolute right-6 top-5 text-right">{corner}</div>
      )}
    </div>
  );
}

/**
 * Host control bar: bottom-right, nearly invisible until hovered so it
 * doesn't distract on the projection. Render anywhere inside a
 * PresenterLayout (it positions itself absolutely).
 */
export function ControlBar({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 opacity-30 transition-opacity duration-200 hover:opacity-100">
      {children}
    </div>
  );
}

/** Small, unobtrusive button for the presenter control bar. */
export function BarButton({
  onClick,
  children,
  primary = false,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
        (primary
          ? "bg-[var(--accent)] text-zinc-950 hover:brightness-110"
          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300")
      }
    >
      {children}
    </button>
  );
}

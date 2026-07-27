"use client";
/**
 * Persistent, unobtrusive audio controls for the presenter screen: a music
 * volume slider and an SFX mute toggle. Mounted once in `PresenterLayout`
 * so every game gets it for free. Reads/writes `lib/soundPrefs.ts` only —
 * it never touches the AudioContext directly.
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_MUSIC_VOLUME,
  getMusicVolume,
  isSfxMuted,
  setMusicVolume,
  setSfxMuted,
  subscribe,
} from "@/lib/soundPrefs";

export function SoundToggle() {
  const musicVolume = useSyncExternalStore(subscribe, getMusicVolume, () => DEFAULT_MUSIC_VOLUME);
  const sfxMuted = useSyncExternalStore(subscribe, isSfxMuted, () => false);

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1.5 text-white">
      <span aria-hidden className="text-sm">
        🎵
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={musicVolume}
        onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
        aria-label="Music volume"
        className="h-1 w-16 cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
      <button
        onClick={() => setSfxMuted(!sfxMuted)}
        aria-label={sfxMuted ? "Unmute sound effects" : "Mute sound effects"}
        aria-pressed={sfxMuted}
        className="text-base leading-none"
      >
        {sfxMuted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}

/**
 * Per-device sound preferences: music volume and an SFX mute flag.
 * Plain module (no React) so both `lib/audio.ts` and game `sound.ts`
 * files can read it, and `useSyncExternalStore` can wrap it for UI.
 * Persisted to localStorage; safe to import from server-rendered code
 * since nothing here touches storage outside a function call.
 */
const MUSIC_VOLUME_KEY = "roomful:musicVolume";
const SFX_MUTED_KEY = "roomful:muted:sfx";
export const DEFAULT_MUSIC_VOLUME = 0.75;

let musicVolume = DEFAULT_MUSIC_VOLUME;
let sfxMuted = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  const savedVolume = localStorage.getItem(MUSIC_VOLUME_KEY);
  if (savedVolume !== null) {
    const parsed = parseFloat(savedVolume);
    if (!Number.isNaN(parsed)) musicVolume = Math.min(1, Math.max(0, parsed));
  }
  sfxMuted = localStorage.getItem(SFX_MUTED_KEY) === "1";
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  load();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMusicVolume(): number {
  load();
  return musicVolume;
}

export function setMusicVolume(volume: number) {
  musicVolume = Math.min(1, Math.max(0, volume));
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
  }
  notify();
}

export function isSfxMuted(): boolean {
  load();
  return sfxMuted;
}

export function setSfxMuted(muted: boolean) {
  sfxMuted = muted;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SFX_MUTED_KEY, muted ? "1" : "0");
  }
  notify();
}

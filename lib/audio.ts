/**
 * Shared Web Audio plumbing: one lazily-created AudioContext for the whole
 * app (games mount one at a time, so a singleton avoids leaking a context
 * per game), split into a `music` bus and an `sfx` bus so the two can be
 * controlled independently from `lib/soundPrefs.ts`. Browsers only allow
 * audio to start from a real user gesture, so `unlockAudio()` must be
 * called from a click/keypress handler before anything plays.
 */
import { getMusicVolume, isSfxMuted, subscribe } from "./soundPrefs";

let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let bgmSource: AudioBufferSourceNode | null = null;
let bgmUrl: string | null = null;
// Bumped by every playBgm()/stopBgm() call so an in-flight decode can tell
// whether it's been superseded — comparing just the url isn't enough,
// since a second playBgm() for the *same* track (e.g. React StrictMode's
// double effect invocation on mount) would make a stale call's url check
// pass again, starting an orphaned source stopBgm() can no longer reach.
let bgmGeneration = 0;
const bufferCache = new Map<string, Promise<AudioBuffer>>();

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();

    musicGain = ctx.createGain();
    musicGain.gain.value = getMusicVolume();
    musicGain.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = isSfxMuted() ? 0 : 1;
    sfxGain.connect(ctx.destination);

    subscribe(() => {
      if (musicGain) musicGain.gain.value = getMusicVolume();
      if (sfxGain) sfxGain.gain.value = isSfxMuted() ? 0 : 1;
    });
  }
  return ctx;
}

/** Call from a user-gesture handler to unlock playback for the rest of the page. */
export function unlockAudio() {
  const audioCtx = getContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

/** One short synthesized cue, routed through the sfx bus. */
export function playBlip(opts: {
  type: OscillatorType;
  freqStart: number;
  freqEnd: number;
  duration: number;
  gain: number;
  /** Seconds from now before the blip starts (for little arpeggios). */
  delay?: number;
}) {
  getContext();
  const audioCtx = ctx!;
  const start = audioCtx.currentTime + (opts.delay ?? 0);

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.connect(gainNode);
  gainNode.connect(sfxGain!);

  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, start);
  osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, start + opts.duration);

  gainNode.gain.setValueAtTime(opts.gain, start);
  gainNode.gain.exponentialRampToValueAtTime(0.001, start + opts.duration);

  osc.start(start);
  osc.stop(start + opts.duration);
}

function loadBuffer(url: string): Promise<AudioBuffer> {
  const audioCtx = getContext();
  let pending = bufferCache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => audioCtx.decodeAudioData(data));
    bufferCache.set(url, pending);
  }
  return pending;
}

/** Starts a looping background track on the music bus, replacing any track already playing. */
export async function playBgm(url: string) {
  if (bgmUrl === url && bgmSource) return;
  stopBgm();
  bgmUrl = url;
  const generation = ++bgmGeneration;

  const buffer = await loadBuffer(url);
  if (generation !== bgmGeneration) return; // superseded while this was loading

  const audioCtx = getContext();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(musicGain!);
  source.start();
  bgmSource = source;
}

/** Stops the currently playing background track, if any. */
export function stopBgm() {
  bgmUrl = null;
  bgmGeneration++; // invalidate any in-flight playBgm() decode, matched or not
  if (bgmSource) {
    try {
      bgmSource.stop();
    } catch {
      // already stopped
    }
    bgmSource.disconnect();
    bgmSource = null;
  }
}

/**
 * Flappy Human — audio. Two independent pieces:
 *
 * 1. SFX: short synthesized blips via the Web Audio API (no audio assets),
 *    copying games/chomp-chomp/sound.ts's exact pattern — a lazily-created
 *    AudioContext, unlockAudio() called from a user gesture, and an
 *    oscillator+gain-envelope playBlip() helper.
 * 2. Background music: a looping decoded mp3 played through a plain <audio>
 *    element (not AudioContext — that's for short synthesized tones, a
 *    background track is simpler as a normal <audio> element).
 *
 * Muting: createBackgroundMusic().setMuted() only controls the music
 * element. It does NOT gate the SFX functions below — Play.tsx owns the
 * single mute toggle and is responsible for skipping playFlapSound() /
 * playScoreSound() / playCrashSound() calls itself when muted, and for
 * calling setMuted() on the music controller in lockstep, so one toggle
 * controls both.
 */
import { CONFIG } from "./config";

// --- SFX (synthesized, Web Audio API) ---

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Call from a button's onClick to unlock playback for the rest of the page. */
export function unlockAudio() {
  const audioCtx = getContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playBlip(opts: {
  type: OscillatorType;
  freqStart: number;
  freqEnd: number;
  duration: number;
  gain: number;
}) {
  const audioCtx = getContext();
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, now + opts.duration);

  gainNode.gain.setValueAtTime(opts.gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);

  osc.start(now);
  osc.stop(now + opts.duration);
}

/** Plays on each detected flap: a quick bright ascending square-wave blip. */
export function playFlapSound() {
  playBlip({ type: "square", freqStart: 250, freqEnd: 450, duration: 0.06, gain: 0.15 });
}

/** Plays when the bird passes a pipe: a cheerful short rising triangle blip. */
export function playScoreSound() {
  playBlip({ type: "triangle", freqStart: 500, freqEnd: 750, duration: 0.1, gain: 0.15 });
}

/** Plays on collision: a low descending sawtooth thud. */
export function playCrashSound() {
  playBlip({ type: "sawtooth", freqStart: 200, freqEnd: 40, duration: 0.5, gain: 0.2 });
}

// --- Background music (decoded mp3, plain <audio> element) ---

export interface BackgroundMusic {
  play(): void;
  stop(): void;
  setMuted(muted: boolean): void;
}

/**
 * Lazily creates the <audio> element on first play()/setMuted() call (not at
 * module load), matching the "only touch browser APIs when actually called"
 * discipline the SFX AudioContext uses. play() is safe to call from the same
 * user-gesture handler that calls unlockAudio().
 */
export function createBackgroundMusic(): BackgroundMusic {
  let audio: HTMLAudioElement | null = null;

  function getAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio(CONFIG.BG_MUSIC_SRC);
      audio.loop = true;
      audio.volume = CONFIG.BG_MUSIC_VOLUME;
    }
    return audio;
  }

  return {
    play() {
      getAudio().play().catch(() => {
        // Ignored: playback can be rejected if called outside a user
        // gesture (e.g. a stray re-render); the next real gesture retries it.
      });
    },
    stop() {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    },
    setMuted(muted: boolean) {
      getAudio().muted = muted;
    },
  };
}

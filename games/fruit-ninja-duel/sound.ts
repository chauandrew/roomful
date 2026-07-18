/**
 * Short synthesized blips via the Web Audio API — no audio assets needed.
 * Browsers only allow audio to start from a real user gesture, so
 * `unlockAudio()` must be called from a click handler before any round plays.
 */
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

/** Plays per fruit-slicing stroke: a bright, quick descending blip. */
export function playSliceSound() {
  playBlip({ type: "square", freqStart: 700, freqEnd: 220, duration: 0.07, gain: 0.15 });
}

/** Plays when a bomb is sliced: harsher and much lower than any fruit sound. */
export function playBombSound() {
  playBlip({ type: "sawtooth", freqStart: 160, freqEnd: 40, duration: 0.35, gain: 0.25 });
}

/** Plays when a fruit falls off-screen uncut: a soft falling whimper. */
export function playMissSound() {
  playBlip({ type: "sine", freqStart: 330, freqEnd: 110, duration: 0.25, gain: 0.12 });
}

/** Plays once when the round ends: a long low slide down. */
export function playGameOverSound() {
  playBlip({ type: "sawtooth", freqStart: 220, freqEnd: 55, duration: 0.6, gain: 0.2 });
}

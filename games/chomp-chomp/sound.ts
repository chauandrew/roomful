/**
 * A short synthesized "chomp" blip via the Web Audio API — no audio assets
 * needed. Browsers only allow audio to start from a real user gesture, so
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

/** Plays once per dot eaten: a quick descending square-wave blip. */
export function playChompSound() {
  playBlip({ type: "square", freqStart: 520, freqEnd: 180, duration: 0.08, gain: 0.15 });
}

/** Plays the instant the mouth crosses open threshold: a short rising sine blip. */
export function playMouthOpenSound() {
  playBlip({ type: "sine", freqStart: 300, freqEnd: 600, duration: 0.05, gain: 0.08 });
}

/** Plays the instant the mouth drops back below the open threshold: a short falling sine blip. */
export function playMouthCloseSound() {
  playBlip({ type: "sine", freqStart: 600, freqEnd: 300, duration: 0.05, gain: 0.08 });
}

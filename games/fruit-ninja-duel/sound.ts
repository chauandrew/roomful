/**
 * Short synthesized blips via the shared Web Audio bus — no audio assets
 * needed. Browsers only allow audio to start from a real user gesture, so
 * `unlockAudio()` must be called from a click handler before any round plays.
 */
export { unlockAudio } from "@/lib/audio";
import { playBlip } from "@/lib/audio";

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

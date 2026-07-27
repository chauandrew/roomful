/**
 * A short synthesized "chomp" blip via the shared Web Audio bus — no audio
 * assets needed. Browsers only allow audio to start from a real user
 * gesture, so `unlockAudio()` must be called from a click handler before
 * any round plays.
 */
export { unlockAudio } from "@/lib/audio";
import { playBlip } from "@/lib/audio";

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

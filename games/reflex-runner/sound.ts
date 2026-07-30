/**
 * Reflex Runner — short synthesized cues via the shared Web Audio bus, no
 * audio assets needed. Browsers only allow audio to start from a real user
 * gesture, so `unlockAudio()` must be called from a click/keypress before
 * any of these play.
 */
export { unlockAudio } from "@/lib/audio";
import { playBlip } from "@/lib/audio";

/** Plays on a detected jump: a quick bright ascending square-wave blip. */
export function playJumpSound() {
  playBlip({ type: "square", freqStart: 300, freqEnd: 550, duration: 0.08, gain: 0.15 });
}

/** Plays while ducking under a bar cleanly (on obstacle pass, same as scoring). */
export function playScoreSound() {
  playBlip({ type: "triangle", freqStart: 500, freqEnd: 750, duration: 0.1, gain: 0.15 });
}

/** Plays on collision: a low descending sawtooth thud. */
export function playCrashSound() {
  playBlip({ type: "sawtooth", freqStart: 200, freqEnd: 40, duration: 0.5, gain: 0.2 });
}

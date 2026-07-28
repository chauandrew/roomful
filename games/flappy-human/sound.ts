/**
 * Flappy Human — short synthesized cues via the shared Web Audio bus, no
 * audio assets needed. Background music is a separate looping mp3/ogg
 * played via lib/audio.ts's playBgm()/stopBgm(), called directly from
 * Play.tsx (see the games with sound.ts + playBgm side by side, e.g.
 * chomp-chomp/Play.tsx). Browsers only allow audio to start from a real
 * user gesture, so `unlockAudio()` must be called from a click/keypress
 * before any of these play.
 */
export { unlockAudio } from "@/lib/audio";
import { playBlip } from "@/lib/audio";

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

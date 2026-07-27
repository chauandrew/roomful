/**
 * Crossy Beach — short synthesized cues via the shared Web Audio bus, one
 * per SoundKind the server can trigger. No audio assets needed.
 * Browsers only allow audio to start from a real user gesture, so
 * `unlockAudio()` must be called from a click/keypress before cues play.
 */
export { unlockAudio } from "@/lib/audio";
import { playBlip } from "@/lib/audio";

/** Every turtle hop: a tiny bright pop. */
export function playHop() {
  playBlip({ type: "square", freqStart: 420, freqEnd: 640, duration: 0.05, gain: 0.08 });
}

/** Hit by a crab/volleyball: a flat low thud. */
export function playSplat() {
  playBlip({ type: "sawtooth", freqStart: 180, freqEnd: 50, duration: 0.22, gain: 0.22 });
}

/** Fell in the water / swept by a wave: a wet descending bloop. */
export function playSplash() {
  playBlip({ type: "sine", freqStart: 620, freqEnd: 120, duration: 0.28, gain: 0.2 });
}

/** Bird strike: a sharp high jab. */
export function playPeck() {
  playBlip({ type: "square", freqStart: 1100, freqEnd: 350, duration: 0.09, gain: 0.18 });
}

/** Cleared a level: two quick rising blips. */
export function playLevelup() {
  playBlip({ type: "triangle", freqStart: 440, freqEnd: 660, duration: 0.12, gain: 0.18 });
  playBlip({ type: "triangle", freqStart: 660, freqEnd: 990, duration: 0.16, gain: 0.18, delay: 0.12 });
}

/** Tide timer expired: a sagging two-step down. */
export function playTimeout() {
  playBlip({ type: "sine", freqStart: 400, freqEnd: 300, duration: 0.15, gain: 0.18 });
  playBlip({ type: "sine", freqStart: 300, freqEnd: 180, duration: 0.25, gain: 0.18, delay: 0.15 });
}

/** Made it to the sea: a little fanfare arpeggio. */
export function playWin() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((freq, i) => {
    playBlip({
      type: "triangle",
      freqStart: freq,
      freqEnd: freq,
      duration: i === notes.length - 1 ? 0.4 : 0.14,
      gain: 0.18,
      delay: i * 0.13,
    });
  });
}

/** Out of lives: a long slow slide down. */
export function playGameover() {
  playBlip({ type: "sawtooth", freqStart: 220, freqEnd: 45, duration: 0.8, gain: 0.2 });
}

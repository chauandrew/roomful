/**
 * Replays a recorded flap session (see recorder.ts / Play.tsx's dev-only
 * "Download flap recording" button) through FlapDetector, printing a
 * timeline of every detected flap. Use this to calibrate the thresholds in
 * config.ts against real captured motion instead of guessing blindly:
 *
 *   npx tsx games/flappy-human/replay-recording.ts path/to/recording.json
 *
 * Tweak FLAP_START_VELOCITY / FLAP_MIN_TRAVEL / FLAP_SETTLE_MS /
 * FLAP_COOLDOWN_MS in config.ts, rerun against the same recording, and
 * compare the printed flap count/timing against what you actually did while
 * recording (e.g. "I flapped 8 times, evenly spaced" — does the timeline
 * below show 8, or did some get missed/doubled?).
 */
import { readFileSync } from "node:fs";
import { FlapDetector, isBodyVisible } from "./detector";
import type { RecordedSample } from "./recorder";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx games/flappy-human/replay-recording.ts <recording.json>");
  process.exit(1);
}

const { samples } = JSON.parse(readFileSync(path, "utf8")) as { samples: RecordedSample[] };
if (samples.length < 2) {
  console.error(`Recording has only ${samples.length} sample(s) — nothing meaningful to replay.`);
  process.exit(1);
}

const detector = new FlapDetector();
const t0 = samples[0].tMs;
let prevTMs = t0;
let flapCount = 0;
let notVisibleCount = 0;

console.log(`Replaying ${samples.length} samples spanning ${((samples.at(-1)!.tMs - t0) / 1000).toFixed(1)}s\n`);

for (const sample of samples) {
  const dtMs = Math.max(1, sample.tMs - prevTMs);
  prevTMs = sample.tMs;

  if (sample.landmarks && !isBodyVisible(sample.landmarks)) notVisibleCount += 1;

  const { flapped } = detector.update(sample.landmarks, dtMs);
  if (flapped) {
    flapCount += 1;
    const tSec = ((sample.tMs - t0) / 1000).toFixed(2);
    console.log(`  flap #${flapCount} at t=${tSec}s`);
  }
}

console.log(`\n${flapCount} flap(s) detected. ${notVisibleCount} sample(s) had a not-fully-visible body.`);

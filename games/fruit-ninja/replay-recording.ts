/**
 * Replays a recorded fruit-ninja hand session (see recorder.ts / Play.tsx's
 * dev-only "Download hand recording" button) — MediaPipe's raw, pre-filter
 * output — reporting the numbers needed to tell apart the tracking failure
 * modes seen in practice: total dropout (MediaPipe found nothing), the
 * MIN_HAND_SPAN filter rejecting a real hand (distance from camera), hand
 * rotation away from the camera (z-spread), and — via the real tracker —
 * dead-reckon bridging and swipe speed.
 *
 *   npx tsx games/fruit-ninja/replay-recording.ts path/to/recording.json
 */
import { readFileSync } from "node:fs";
import { createHandTracker, updateHandTracker, type HandDetection } from "@/lib/fruit-ninja/handTracker";
import { handSpan, MIN_HAND_SPAN, INDEX_FINGERTIP } from "@/lib/fruit-ninja/handSelection";
import type { RecordedSample } from "@/lib/tracking/recorder";
import type { RawHandSample } from "./recorder";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx games/fruit-ninja/replay-recording.ts <recording.json>");
  process.exit(1);
}

const { samples } = JSON.parse(readFileSync(path, "utf8")) as { samples: RecordedSample<RawHandSample[]>[] };
if (samples.length < 2) {
  console.error(`Recording has only ${samples.length} sample(s) — nothing meaningful to replay.`);
  process.exit(1);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  return sortedAsc[Math.floor((sortedAsc.length - 1) * p)];
}

function summarize(label: string, values: number[], digits = 4) {
  if (values.length === 0) {
    console.log(`${label}: (no data)`);
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `${label}: p50=${percentile(sorted, 0.5).toFixed(digits)}, p95=${percentile(sorted, 0.95).toFixed(digits)}, ` +
      `max=${sorted.at(-1)!.toFixed(digits)} (n=${values.length})`
  );
}

const ASPECT = 16 / 9; // recordings don't carry canvas size; close enough for a span estimate

// --- Raw "MediaPipe found zero hands" dropout runs — unconfounded by our own filter. ---
const dropoutDurationsMs: number[] = [];
let dropoutStartTMs: number | null = null;
for (const sample of samples) {
  const empty = sample.data.length === 0;
  if (empty && dropoutStartTMs === null) dropoutStartTMs = sample.tMs;
  if (!empty && dropoutStartTMs !== null) {
    dropoutDurationsMs.push(sample.tMs - dropoutStartTMs);
    dropoutStartTMs = null;
  }
}
const openDropoutMs = dropoutStartTMs !== null ? samples.at(-1)!.tMs - dropoutStartTMs : 0;

// --- Span (distance-from-camera proxy) and z-spread (rotation-from-camera proxy), split
// into session thirds so a far-then-close (or flat-then-edge-on) session shows the trend. ---
const thirdBoundary1 = samples[0].tMs + (samples.at(-1)!.tMs - samples[0].tMs) / 3;
const thirdBoundary2 = samples[0].tMs + (2 * (samples.at(-1)!.tMs - samples[0].tMs)) / 3;
const spansByThird: [number[], number[], number[]] = [[], [], []];
const zSpreadsByThird: [number[], number[], number[]] = [[], [], []];
let rawHandCount = 0;
let rejectedByFilterCount = 0;
let samplesWithRawHandsButNoneKept = 0;

for (const sample of samples) {
  const third = sample.tMs < thirdBoundary1 ? 0 : sample.tMs < thirdBoundary2 ? 1 : 2;
  let keptAny = false;
  for (const hand of sample.data) {
    rawHandCount++;
    const span = handSpan(hand.landmarks, ASPECT);
    spansByThird[third].push(span);
    const zs = hand.landmarks.map((l) => l.z);
    zSpreadsByThird[third].push(Math.max(...zs) - Math.min(...zs));
    if (span < MIN_HAND_SPAN) rejectedByFilterCount++;
    else keptAny = true;
  }
  if (sample.data.length > 0 && !keptAny) samplesWithRawHandsButNoneKept++;
}

// --- Speed and dead-reckon bridging, via the real tracker fed the same
// filtered detections Play.tsx would have produced. ---
let state = createHandTracker();
const speedsUnitsPerMs: number[] = [];
let bridgedPoints = 0;
let realPoints = 0;

for (const sample of samples) {
  const detections: HandDetection[] = sample.data
    .filter((hand) => handSpan(hand.landmarks, ASPECT) >= MIN_HAND_SPAN)
    .map((hand) => {
      const tip = hand.landmarks[INDEX_FINGERTIP];
      return { x: tip.x, y: tip.y, handedness: hand.handedness };
    });
  state = updateHandTracker(state, detections, sample.tMs);
  for (const slot of state) {
    if (slot.vx !== undefined && slot.vy !== undefined) {
      speedsUnitsPerMs.push(Math.hypot(slot.vx, slot.vy));
    }
    const last = slot.trail[slot.trail.length - 1];
    if (last && last.t === sample.tMs) {
      if (last.bridged) bridgedPoints++;
      else realPoints++;
    }
  }
}

const sessionMs = samples.at(-1)!.tMs - samples[0].tMs;
console.log(`Replayed ${samples.length} samples spanning ${(sessionMs / 1000).toFixed(1)}s\n`);

console.log("--- Raw MediaPipe dropout (unaffected by our own filter) ---");
const sortedDropouts = [...dropoutDurationsMs].sort((a, b) => a - b);
console.log(
  `No-hand dropouts: ${sortedDropouts.length} resolved ` +
    `(p50=${percentile(sortedDropouts, 0.5).toFixed(0)}ms, p95=${percentile(sortedDropouts, 0.95).toFixed(0)}ms, ` +
    `max=${(sortedDropouts.at(-1) ?? 0).toFixed(0)}ms)`
);
if (openDropoutMs > 0) {
  console.log(
    `  plus one UNRESOLVED dropout still ongoing when the recording ended: ${openDropoutMs.toFixed(0)}ms`
  );
}
const totalDropoutMs = dropoutDurationsMs.reduce((a, b) => a + b, 0) + openDropoutMs;
console.log(
  `Total time with zero hands detected: ${totalDropoutMs.toFixed(0)}ms of ${sessionMs.toFixed(0)}ms ` +
    `(${((totalDropoutMs / sessionMs) * 100).toFixed(0)}%)\n`
);

console.log("--- MIN_HAND_SPAN filter impact ---");
console.log(`Raw hands seen: ${rawHandCount}, rejected as too small: ${rejectedByFilterCount}`);
console.log(
  `Samples where MediaPipe found a hand but the filter rejected all of them: ${samplesWithRawHandsButNoneKept} ` +
    `(these would show as dropout in-game even though MediaPipe detected something)\n`
);

console.log("--- Hand span by session third (distance-from-camera proxy; note aspect is estimated) ---");
["First third", "Middle third", "Last third"].forEach((label, i) => summarize(label, spansByThird[i]));
console.log(`  MIN_HAND_SPAN is currently ${MIN_HAND_SPAN}\n`);

console.log("--- Landmark z-spread by session third (rotation-from-camera proxy) ---");
["First third", "Middle third", "Last third"].forEach((label, i) => summarize(label, zSpreadsByThird[i]));
console.log("");

console.log("--- Real tracker: speed and dead-reckon bridging ---");
const sortedSpeeds = [...speedsUnitsPerMs].sort((a, b) => a - b);
console.log(
  `Hand speed, units/ms (p50=${percentile(sortedSpeeds, 0.5).toFixed(4)}, ` +
    `p95=${percentile(sortedSpeeds, 0.95).toFixed(4)}, max=${(sortedSpeeds.at(-1) ?? 0).toFixed(4)})`
);
console.log(`Bridged (dead-reckoned) trail points: ${bridgedPoints} of ${bridgedPoints + realPoints} total.`);

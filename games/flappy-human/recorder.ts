/**
 * Records the exact landmark samples FlapDetector sees during a real play
 * session, so they can be replayed later (see replay-recording.ts) to
 * calibrate detection thresholds against real captured motion instead of
 * guessing. Dev tool only — see the "Download flap recording" button gated
 * behind process.env.NODE_ENV in Play.tsx.
 */
import type { Landmark } from "@/lib/tracking/types";

export interface RecordedSample {
  /** performance.now() at capture time. */
  tMs: number;
  landmarks: Landmark[] | null;
}

export class FlapRecorder {
  private samples: RecordedSample[] = [];
  private recording = false;

  start() {
    this.samples = [];
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  /** Call once per genuinely new landmark sample (not per animation frame — see Play.tsx's isNewSample). */
  record(landmarks: Landmark[] | undefined | null, tMs: number) {
    if (!this.recording) return;
    this.samples.push({ tMs, landmarks: landmarks ?? null });
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Triggers a browser download of the recorded samples as JSON, replayable via replay-recording.ts. */
  download(filename = `flappy-human-recording-${Date.now()}.json`) {
    const blob = new Blob([JSON.stringify({ samples: this.samples }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * Generic session recorder: captures timestamped samples during real
 * gameplay so detector/tracker tuning can be checked against real captured
 * motion instead of guessed blind. Dev tool only — see each game's
 * recorder.ts for the per-game sample type and replay-recording.ts for how a
 * download from this gets replayed offline.
 */
export interface RecordedSample<T> {
  /** performance.now() at capture time. */
  tMs: number;
  data: T;
}

export class Recorder<T> {
  private samples: RecordedSample<T>[] = [];
  private recording = false;

  start() {
    this.samples = [];
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  /** Call once per genuinely new sample (not per animation frame). */
  record(data: T, tMs: number) {
    if (!this.recording) return;
    this.samples.push({ tMs, data });
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Triggers a browser download of the recorded samples as JSON. */
  download(filename: string) {
    const blob = new Blob([JSON.stringify({ samples: this.samples }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * Records the exact landmark samples FlapDetector sees during a real play
 * session, so they can be replayed later (see replay-recording.ts) to
 * calibrate detection thresholds against real captured motion instead of
 * guessing. Dev tool only — see the "Download flap recording" button gated
 * behind process.env.NODE_ENV in Play.tsx.
 */
import { Recorder } from "@/lib/tracking/recorder";
import type { Landmark } from "@/lib/tracking/types";

export class FlapRecorder extends Recorder<Landmark[] | null> {
  record(landmarks: Landmark[] | undefined | null, tMs: number) {
    super.record(landmarks ?? null, tMs);
  }

  download(filename = `flappy-human-recording-${Date.now()}.json`) {
    super.download(filename);
  }
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver } from "@mediapipe/tasks-vision";

const TASKS_VERSION = "1.0.0";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const isDev = process.env.NODE_ENV !== "production";

// Only Chrome (desktop/Android, M112+) exposes exposureTime at all — never
// Safari, never Firefox — so this is a no-op almost everywhere. Where it
// works, a shorter exposure trades a darker/noisier image for far less
// motion blur on a fast swipe. Unmeasured starting point (~1/320s, in the
// spec's 100-microsecond units); retune once real capability ranges are
// known from the dev console log below.
const TARGET_EXPOSURE_TIME_UNITS = 312;

/**
 * Best-effort manual exposure lock. Must never throw or block camera start:
 * every step here is either unsupported on most browsers or can be silently
 * rejected by the driver, and getting a working (if blurrier) camera stream
 * is always better than failing over an exposure tweak.
 */
async function tryLockExposure(track: MediaStreamTrack | undefined) {
  if (!track?.getCapabilities) return;
  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      exposureTime?: { min: number; max: number };
    };
    if (!caps.exposureTime) return;
    const exposureTime = Math.min(caps.exposureTime.max, Math.max(caps.exposureTime.min, TARGET_EXPOSURE_TIME_UNITS));
    // Mode must land before the value in a separate call, or the value is
    // silently ignored — see MDN's MediaStreamTrack.applyConstraints().
    await track.applyConstraints({ advanced: [{ exposureMode: "manual" } as MediaTrackConstraintSet] });
    await track.applyConstraints({ advanced: [{ exposureTime } as MediaTrackConstraintSet] });
  } catch {
    // Unsupported or rejected — leave exposure on auto.
  }
}

function percentile(sortedAsc: number[], p: number): number {
  return sortedAsc[Math.floor((sortedAsc.length - 1) * p)];
}

/** Dev-only: prints real camera capability/negotiated settings once, so
 *  Phase-1-style capture tuning is based on what the hardware actually gave
 *  us instead of what was requested. */
function logCameraDiagnostics(track: MediaStreamTrack | undefined) {
  if (!track) return;
  console.log("[tracking] camera settings", track.getSettings());
  console.log("[tracking] camera capabilities", track.getCapabilities?.());
}

export type TrackingStatus = "loading" | "ready" | "error";

export interface TrackingResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: TrackingStatus;
  errorMessage: string | null;
}

interface Landmarker<TResult> {
  detectForVideo(videoFrame: HTMLVideoElement, timestamp: number): TResult;
  close(): void;
}

interface LandmarkerModule<TLandmarker, TOptions> {
  createFromOptions(wasmFileset: WasmFileset, options: TOptions): Promise<TLandmarker>;
}

interface MediaPipeTrackingConfig<TLandmarker extends Landmarker<TResult>, TResult, TOptions> {
  landmarker: LandmarkerModule<TLandmarker, TOptions>;
  modelUrl: string;
  detectorOptions: Omit<TOptions, "baseOptions" | "runningMode">;
  onResult?: (result: TResult | null) => void;
}

/**
 * Owns getUserMedia + a MediaPipe landmarker model + an rAF detection loop.
 * Landmarks are delivered via the onResult callback rather than React state —
 * at up to 60fps, routing them through state would re-render the whole tree
 * every frame.
 */
export function useMediaPipeTracking<TLandmarker extends Landmarker<TResult>, TResult, TOptions>({
  landmarker: LandmarkerClass,
  modelUrl,
  detectorOptions,
  onResult,
}: MediaPipeTrackingConfig<TLandmarker, TResult, TOptions>): TrackingResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<TrackingStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const classifyError = useCallback((err: unknown): string => {
    if (err instanceof DOMException) {
      if (err.name === "NotAllowedError") return "Camera permission was denied. Allow camera access and reload.";
      if (err.name === "NotFoundError") return "No camera found. Plug one in and reload.";
    }
    const message = err instanceof Error ? err.message : String(err);
    return "Couldn't start the camera: " + message;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: TLandmarker | null = null;
    let rafId: number | null = null;
    let lastVideoTime = -1;
    let lastResult: TResult | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser doesn't support camera access.");
      }
      const baseVideo = { facingMode: "user" as const, width: { ideal: 1280 }, height: { ideal: 720 } };
      try {
        // 60fps ideal, 24fps floor: fast motions can last only a few frames
        // at 30fps, so every extra sample helps detection. The floor is also
        // an anti-blur lever even when it changes no frame rate — a driver
        // can't hold a long exposure while honoring a frame-rate floor, so
        // it caps exposure instead of dropping frames in a dim room.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...baseVideo, frameRate: { ideal: 60, min: 24 } },
          audio: false,
        });
      } catch (err) {
        // A camera that can't sustain 24fps (rare) would otherwise fail to
        // start at all — fall back to the old unconstrained request.
        if (!(err instanceof OverconstrainedError)) throw err;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...baseVideo, frameRate: { ideal: 60 } },
          audio: false,
        });
      }
      await tryLockExposure(stream.getVideoTracks()[0]);
      if (isDev) logCameraDiagnostics(stream.getVideoTracks()[0]);
      const video = videoRef.current;
      if (!video) throw new Error("Video element not mounted.");
      video.srcObject = stream;
      await video.play();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    }

    async function loadModel() {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      landmarker = await LandmarkerClass.createFromOptions(vision, {
        ...detectorOptions,
        baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
        runningMode: "VIDEO",
      } as TOptions);
    }

    // Dev-only rolling stats: real camera fps and detectForVideo latency,
    // logged every few seconds so tuning is based on measurement instead of
    // what getUserMedia was merely asked for.
    let frameDts: number[] = [];
    let inferenceMs: number[] = [];
    let lastFrameAt = 0;
    let lastLoggedAt = 0;

    function loop() {
      rafId = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!landmarker || !video || video.readyState < 2) return;

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        lastResult = landmarker.detectForVideo(video, now);
        if (isDev) {
          if (lastFrameAt > 0) frameDts.push(now - lastFrameAt);
          lastFrameAt = now;
          inferenceMs.push(performance.now() - now);
          if (now - lastLoggedAt > 3000 && frameDts.length > 5) {
            const dts = [...frameDts].sort((a, b) => a - b);
            const infer = [...inferenceMs].sort((a, b) => a - b);
            console.log(
              `[tracking] ~${(1000 / percentile(dts, 0.5)).toFixed(1)}fps ` +
                `(frame dt p50=${percentile(dts, 0.5).toFixed(1)}ms p95=${percentile(dts, 0.95).toFixed(1)}ms) | ` +
                `inference p50=${percentile(infer, 0.5).toFixed(1)}ms p95=${percentile(infer, 0.95).toFixed(1)}ms`
            );
            frameDts = [];
            inferenceMs = [];
            lastLoggedAt = now;
          }
        }
      }
      onResultRef.current?.(lastResult);
    }

    (async () => {
      try {
        await Promise.all([startCamera(), loadModel()]);
        if (cancelled) return;
        setStatus("ready");
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(classifyError(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, [LandmarkerClass, modelUrl, detectorOptions, classifyError]);

  return { videoRef, canvasRef, status, errorMessage };
}

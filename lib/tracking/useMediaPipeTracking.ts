"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver } from "@mediapipe/tasks-vision";

const TASKS_VERSION = "1.0.0";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

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
      // 60fps ideal: fast motions can last only a few frames at 30fps, so every
      // extra sample helps detection. Cameras that can't do 60 fall back gracefully.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
        audio: false,
      });
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

    function loop() {
      rafId = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!landmarker || !video || video.readyState < 2) return;

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        lastResult = landmarker.detectForVideo(video, performance.now());
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

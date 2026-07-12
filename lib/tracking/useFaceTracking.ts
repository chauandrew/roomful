"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import type { FaceResult } from "./types";

const TASKS_VERSION = "0.10.12";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type FaceTrackingStatus = "loading" | "ready" | "error";

interface UseFaceTrackingOptions {
  /** Called on every new video frame with the latest detection result. */
  onResult?: (result: FaceResult | null) => void;
}

interface UseFaceTrackingResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: FaceTrackingStatus;
  errorMessage: string | null;
}

/**
 * Owns getUserMedia + the MediaPipe FaceLandmarker model + an rAF detection
 * loop — the face-tracking twin of usePoseTracking.ts. Landmarks are
 * delivered via the onResult callback rather than React state — at up to
 * 60fps, routing them through state would re-render the whole tree every frame.
 */
export function useFaceTracking({ onResult }: UseFaceTrackingOptions = {}): UseFaceTrackingResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<FaceTrackingStatus>("loading");
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
    let landmarker: FaceLandmarker | null = null;
    let rafId: number | null = null;
    let lastVideoTime = -1;
    let lastResult: FaceResult | null = null;

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
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
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
  }, [classifyError]);

  return { videoRef, canvasRef, status, errorMessage };
}

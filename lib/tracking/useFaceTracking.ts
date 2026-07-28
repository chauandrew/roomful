"use client";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useMediaPipeTracking, type TrackingResult, type TrackingStatus } from "./useMediaPipeTracking";
import type { FaceResult } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const DETECTOR_OPTIONS = { numFaces: 1 };

export type FaceTrackingStatus = TrackingStatus;

interface UseFaceTrackingOptions {
  /** Called on every new video frame with the latest detection result. */
  onResult?: (result: FaceResult | null) => void;
}

export function useFaceTracking({ onResult }: UseFaceTrackingOptions = {}): TrackingResult {
  return useMediaPipeTracking({
    landmarker: FaceLandmarker,
    modelUrl: MODEL_URL,
    detectorOptions: DETECTOR_OPTIONS,
    onResult,
  });
}

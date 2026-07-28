"use client";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import { useMediaPipeTracking, type TrackingResult, type TrackingStatus } from "./useMediaPipeTracking";
import type { HandResult } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const DETECTOR_OPTIONS = { numHands: 4 };

export type HandTrackingStatus = TrackingStatus;

interface UseHandTrackingOptions {
  /** Called on every new video frame with the latest detection result. */
  onResult?: (result: HandResult | null) => void;
}

export function useHandTracking({ onResult }: UseHandTrackingOptions = {}): TrackingResult {
  return useMediaPipeTracking({
    landmarker: HandLandmarker,
    modelUrl: MODEL_URL,
    detectorOptions: DETECTOR_OPTIONS,
    onResult,
  });
}

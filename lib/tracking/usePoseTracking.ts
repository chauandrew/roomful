"use client";
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { useMediaPipeTracking, type TrackingResult, type TrackingStatus } from "./useMediaPipeTracking";
import type { PoseResult } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const DETECTOR_OPTIONS = { numPoses: 1 };

export type PoseTrackingStatus = TrackingStatus;

interface UsePoseTrackingOptions {
  /** Called on every new video frame with the latest detection result. */
  onResult?: (result: PoseResult | null) => void;
}

export function usePoseTracking({ onResult }: UsePoseTrackingOptions = {}): TrackingResult {
  return useMediaPipeTracking({
    landmarker: PoseLandmarker,
    modelUrl: MODEL_URL,
    detectorOptions: DETECTOR_OPTIONS,
    onResult,
  });
}

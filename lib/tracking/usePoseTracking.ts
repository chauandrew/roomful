"use client";
import { useMemo } from "react";
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { useMediaPipeTracking, type TrackingResult, type TrackingStatus } from "./useMediaPipeTracking";
import type { PoseResult } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type PoseTrackingStatus = TrackingStatus;

interface UsePoseTrackingOptions {
  /** Called on every new video frame with the latest detection result. */
  onResult?: (result: PoseResult | null) => void;
  /** Number of people to detect in frame at once. Defaults to 1. */
  numPoses?: number;
}

export function usePoseTracking({ onResult, numPoses = 1 }: UsePoseTrackingOptions = {}): TrackingResult {
  const detectorOptions = useMemo(() => ({ numPoses }), [numPoses]);
  return useMediaPipeTracking({
    landmarker: PoseLandmarker,
    modelUrl: MODEL_URL,
    detectorOptions,
    onResult,
  });
}

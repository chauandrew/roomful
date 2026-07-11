/**
 * Thin aliases over @mediapipe/tasks-vision's own types, so game code
 * doesn't need to import from the mediapipe package directly.
 */
import type { NormalizedLandmark, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

export type Landmark = NormalizedLandmark;
export type PoseResult = PoseLandmarkerResult;

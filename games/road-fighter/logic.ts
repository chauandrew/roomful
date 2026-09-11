import { BEATS, type Pose } from "./config";

export type RoundReason = "beat" | "tie" | "no-pose" | "double-no-pose";

export interface RoundOutcome {
  loser: "a" | "b" | null; // null = tie or double-no-pose — no damage, round replays
  reason: RoundReason;
}

export function resolveRound(poseA: Pose | null, poseB: Pose | null): RoundOutcome {
  if (poseA === null && poseB === null) return { loser: null, reason: "double-no-pose" };
  if (poseA === null) return { loser: "a", reason: "no-pose" };
  if (poseB === null) return { loser: "b", reason: "no-pose" };
  if (poseA === poseB) return { loser: null, reason: "tie" };
  return BEATS[poseA].includes(poseB) ? { loser: "b", reason: "beat" } : { loser: "a", reason: "beat" };
}

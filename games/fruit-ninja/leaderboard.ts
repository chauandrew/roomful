import { createLeaderboard } from "@/lib/leaderboard";
import { CONFIG } from "./config";

export const { submitScore, getTopScores, getBest, setBest } = createLeaderboard("fruit-ninja", CONFIG);
export type { LeaderboardEntry } from "@/lib/leaderboard";

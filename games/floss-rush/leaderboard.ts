/**
 * Leaderboard data module — LOCAL stand-in (localStorage).
 *
 * >>> BACKEND INTEGRATION POINT <<<
 * This is the ONLY place that touches storage. To go online, write a second
 * implementation of submitScore()/getTopScores() with the same async
 * signatures and swap the import in Play.tsx. Nothing else changes.
 */
import { CONFIG } from "./config";

const STORAGE_KEY = "floss-rush:leaderboard";
const BEST_KEY = "floss-rush:best";

export interface LeaderboardEntry {
  name: string;
  score: number;
  created_at: number;
}

function load(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries: LeaderboardEntry[]) {
  // Keep more than we show, so the local board survives a few low scores dropping off.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 50)));
}

function byScore(a: LeaderboardEntry, b: LeaderboardEntry) {
  return b.score - a.score || a.created_at - b.created_at;
}

/**
 * Persist a score. Mirrors the client-side hygiene a real backend would
 * enforce: trimmed/length-capped name and a clamp at MAX_PLAUSIBLE_SCORE.
 */
export async function submitScore({ name, score }: { name: string; score: number }): Promise<LeaderboardEntry> {
  let cleanName = String(name ?? "").trim().slice(0, CONFIG.NAME_MAX_LEN);
  if (!cleanName) cleanName = "Anon";

  const cleanScore = Math.max(0, Math.min(CONFIG.MAX_PLAUSIBLE_SCORE, Math.round(Number(score) || 0)));

  const entry: LeaderboardEntry = { name: cleanName, score: cleanScore, created_at: Date.now() };
  const entries = load();
  entries.push(entry);
  entries.sort(byScore);
  save(entries);
  return entry;
}

export async function getTopScores(limit: number = CONFIG.LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
  return load().sort(byScore).slice(0, limit);
}

export function getBest(): number {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(BEST_KEY) || 0);
}

export function setBest(v: number) {
  localStorage.setItem(BEST_KEY, String(v));
}

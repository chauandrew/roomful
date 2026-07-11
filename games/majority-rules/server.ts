/**
 * Majority Rules — server logic. The reference SIMULTANEOUS-round game:
 * every player answers the same prompt at once, the host watches the tally
 * fill in live, then reveals and advances.
 *
 * Round flow: answering → (host: reveal) → revealed → (host: next) → …
 * After the last question, phase becomes "final" with the leaderboard.
 *
 * NOTE: no React imports here — this file is bundled into the PartyKit
 * worker. Keep it pure.
 */
import type { Player } from "../../lib/types";
import type { MultiUserGameLogic } from "../types";
import { QUESTIONS } from "./questions";

export interface MRState {
  qIndex: number;
  phase: "answering" | "revealed" | "final";
  /** playerId → optionId, for the current question. Changeable until reveal. */
  answers: Record<string, string>;
  scores: Record<string, number>;
}

export type MRHostAction = { type: "reveal" } | { type: "next" };
export type MRInput = { optionId: string };

function majorityIds(state: MRState): string[] {
  const counts: Record<string, number> = {};
  for (const opt of Object.values(state.answers)) {
    counts[opt] = (counts[opt] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  return Object.keys(counts).filter((id) => counts[id] === max);
}

function leaderboard(state: MRState, players: Player[]) {
  return players
    .map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

export const majorityRulesLogic: MultiUserGameLogic<MRState, MRHostAction, MRInput> = {
  init: (players) => ({
    qIndex: 0,
    phase: "answering",
    answers: {},
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
  }),

  onHostAction(state, action, players) {
    if (action.type === "reveal" && state.phase === "answering") {
      // Score once, at reveal: everyone in the majority gets a point.
      const winners = new Set(majorityIds(state));
      const scores = { ...state.scores };
      for (const p of players) {
        if (winners.has(state.answers[p.id])) {
          scores[p.id] = (scores[p.id] ?? 0) + 1;
        }
      }
      return { ...state, phase: "revealed", scores };
    }
    if (action.type === "next" && state.phase === "revealed") {
      if (state.qIndex + 1 >= QUESTIONS.length) {
        return { ...state, phase: "final" };
      }
      return { ...state, qIndex: state.qIndex + 1, phase: "answering", answers: {} };
    }
    return state;
  },

  onPlayerInput(state, playerId, input) {
    if (state.phase !== "answering") return state;
    const q = QUESTIONS[state.qIndex];
    if (!q.options.some((o) => o.id === input.optionId)) return state;
    return { ...state, answers: { ...state.answers, [playerId]: input.optionId } };
  },

  hostView(state, players) {
    const q = QUESTIONS[state.qIndex];
    const counts: Record<string, number> = {};
    for (const opt of Object.values(state.answers)) {
      counts[opt] = (counts[opt] ?? 0) + 1;
    }
    return {
      phase: state.phase,
      qIndex: state.qIndex,
      qTotal: QUESTIONS.length,
      prompt: q.prompt,
      options: q.options.map((o) => ({ ...o, count: counts[o.id] ?? 0 })),
      answeredCount: Object.keys(state.answers).length,
      playerCount: players.length,
      majority: state.phase === "answering" ? [] : majorityIds(state),
      leaderboard: leaderboard(state, players),
    };
  },

  playerView(state, playerId, players) {
    const q = QUESTIONS[state.qIndex];
    const winners = majorityIds(state);
    return {
      phase: state.phase,
      prompt: q.prompt,
      options: q.options,
      yourAnswer: state.answers[playerId] ?? null,
      // Only meaningful once revealed:
      inMajority:
        state.phase !== "answering" && winners.includes(state.answers[playerId]),
      yourScore: state.scores[playerId] ?? 0,
      leaderboard: state.phase === "final" ? leaderboard(state, players) : null,
    };
  },
};

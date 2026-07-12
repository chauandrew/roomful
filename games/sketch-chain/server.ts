/**
 * Sketch Chain — server logic. The reference SEQUENTIAL/CHAIN game
 * (Gartic-Phone-style relay): each player's output becomes another
 * player's input on the next step.
 *
 * With n players there are n chains and n steps:
 *   step 0        — everyone writes a starting phrase (text)
 *   odd steps     — draw the text you were handed (drawing)
 *   even steps ≥2 — describe the drawing you were handed (text)
 * Chain routing comes from chainAssignments() in games/types.ts, which
 * guarantees every chain visits every player exactly once.
 *
 * When all players have submitted a step, the game auto-advances — no host
 * involvement until the reveal, which the host steps through entry by entry.
 *
 * NOTE: no React imports here — this file is bundled into the PartyKit worker.
 */
import type { Player } from "../../lib/types";
import { chainAssignments, type MultiUserGameLogic } from "../types";

export interface Entry {
  kind: "text" | "drawing";
  /** The phrase, or a PNG data URL for drawings. */
  value: string;
  authorId: string;
}

export interface SCState {
  /** Player order frozen at game start; chains[i] was started by playerIds[i]. */
  playerIds: string[];
  chains: Entry[][];
  step: number;
  phase: "working" | "reveal";
  /** playerIds who submitted the current step. */
  submitted: Record<string, true>;
  /** Reveal cursor: which chain is on screen, and how many entries are shown. */
  cursor: { chain: number; upTo: number };
}

export type SCHostAction =
  | { type: "advance-reveal" }
  /** Fill placeholders for anyone stuck/disconnected and move to the next step. */
  | { type: "force-advance" };

export type SCInput = { value: string };

function stepKind(step: number): "text" | "drawing" {
  return step % 2 === 1 ? "drawing" : "text";
}

function taskName(step: number): "write" | "draw" | "describe" {
  if (step === 0) return "write";
  return step % 2 === 1 ? "draw" : "describe";
}

function advanceStep(state: SCState): SCState {
  const next = state.step + 1;
  if (next >= state.playerIds.length) {
    return { ...state, phase: "reveal", cursor: { chain: 0, upTo: 0 }, submitted: {} };
  }
  return { ...state, step: next, submitted: {} };
}

function name(players: Player[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? "?";
}

export const sketchChainLogic: MultiUserGameLogic<SCState, SCHostAction, SCInput> = {
  init: (players) => ({
    playerIds: players.map((p) => p.id),
    chains: players.map(() => []),
    step: 0,
    phase: "working",
    submitted: {},
    cursor: { chain: 0, upTo: 0 },
  }),

  onHostAction(state, action) {
    const n = state.playerIds.length;

    if (action.type === "force-advance" && state.phase === "working") {
      const assignments = chainAssignments(state.playerIds, state.step);
      const chains = state.chains.map((c) => [...c]);
      for (const pid of state.playerIds) {
        if (!state.submitted[pid]) {
          chains[assignments[pid]].push({
            kind: stepKind(state.step),
            value: stepKind(state.step) === "text" ? "(no answer)" : "",
            authorId: pid,
          });
        }
      }
      return advanceStep({ ...state, chains });
    }

    if (action.type === "advance-reveal" && state.phase === "reveal") {
      const { chain, upTo } = state.cursor;
      if (chain >= n) return state; // already fully revealed
      if (upTo + 1 < state.chains[chain].length) {
        return { ...state, cursor: { chain, upTo: upTo + 1 } };
      }
      return { ...state, cursor: { chain: chain + 1, upTo: 0 } };
    }

    return state;
  },

  onPlayerInput(state, playerId, input) {
    if (state.phase !== "working") return state;
    if (state.submitted[playerId]) return state;
    if (!state.playerIds.includes(playerId)) return state;
    if (typeof input.value !== "string" || !input.value) return state;

    const chainIndex = chainAssignments(state.playerIds, state.step)[playerId];
    const chains = state.chains.map((c) => [...c]);
    chains[chainIndex] = [
      ...chains[chainIndex],
      { kind: stepKind(state.step), value: input.value, authorId: playerId },
    ];
    const next: SCState = {
      ...state,
      chains,
      submitted: { ...state.submitted, [playerId]: true },
    };
    // Auto-advance the moment everyone has submitted.
    if (state.playerIds.every((id) => next.submitted[id])) {
      return advanceStep(next);
    }
    return next;
  },

  hostView(state, players) {
    const n = state.playerIds.length;

    if (state.phase === "working") {
      return {
        phase: "working" as const,
        step: state.step,
        totalSteps: n,
        task: taskName(state.step),
        submittedCount: Object.keys(state.submitted).length,
        playerCount: n,
        waitingOn: state.playerIds
          .filter((id) => !state.submitted[id])
          .map((id) => name(players, id)),
      };
    }

    const { chain, upTo } = state.cursor;
    const allDone = chain >= n;
    // Reveal in reverse: the final entry appears first, the starting prompt last.
    const current = allDone ? [] : [...state.chains[chain]].reverse();
    return {
      phase: "reveal" as const,
      chainIndex: Math.min(chain, n - 1),
      chainCount: n,
      startedBy: allDone ? "" : name(players, state.playerIds[chain]),
      entries: current.slice(0, upTo + 1).map((e) => ({
        kind: e.kind,
        value: e.value,
        authorName: name(players, e.authorId),
      })),
      chainComplete: !allDone && upTo + 1 >= current.length,
      allDone,
    };
  },

  playerView(state, playerId, players) {
    if (state.phase === "reveal") {
      return { phase: "reveal" as const };
    }
    if (state.submitted[playerId] || !state.playerIds.includes(playerId)) {
      return {
        phase: "waiting" as const,
        waitingOn: state.playerIds.filter((id) => !state.submitted[id]).length,
      };
    }
    const chainIndex = chainAssignments(state.playerIds, state.step)[playerId];
    const chain = state.chains[chainIndex];
    const prev = chain[chain.length - 1] ?? null;
    return {
      phase: "working" as const,
      step: state.step,
      totalSteps: state.playerIds.length,
      task: taskName(state.step),
      // What you're reacting to: null on step 0, otherwise the previous
      // player's text or drawing. This is private to you — the personalized
      // playerView projection is what keeps chains secret until the reveal.
      prompt: prev && {
        kind: prev.kind,
        value: prev.value,
        authorName: name(players, prev.authorId),
      },
    };
  },
};

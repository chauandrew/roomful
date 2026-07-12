/**
 * Maps multi-user game ids to their server-side logic. Imported ONLY by the
 * PartyKit room server (party/index.ts) — never from React code, and nothing
 * here may import React.
 *
 * Single-device games don't appear here at all; they have no server.
 *
 * NOTE: uses relative imports (not "@/") because this file is bundled by
 * PartyKit's esbuild, not Next.js.
 */
import type { GameMeta } from "../lib/types";
import type { MultiUserGameLogic } from "./types";

import { sketchChainMeta } from "./sketch-chain/meta";
import { sketchChainLogic } from "./sketch-chain/server";

export interface ServerGame {
  meta: GameMeta;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logic: MultiUserGameLogic<any, any, any>;
}

export const serverGames: Record<string, ServerGame> = {
  "sketch-chain": { meta: sketchChainMeta, logic: sketchChainLogic },
};

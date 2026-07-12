/**
 * THE GAME REGISTRY — the central list of every game Roomful knows about.
 *
 * To add a game (see docs/ADDING_A_GAME.md for the full walkthrough):
 *  1. Create games/<your-game>/meta.ts and import it here.
 *  2. Register its components in games/clientRegistry.tsx.
 *  3. Multi-user games only: register its server logic in
 *     games/server-registry.ts.
 * That's it — the homepage, routes, lobby, and room server pick it up
 * automatically. No shared code changes needed.
 *
 * This file is pure data (no React, no PartyKit) so both the Next.js app
 * (including server components) and anything else can import it safely.
 */
import type { GameMeta } from "@/lib/types";

import { flossRushMeta } from "./floss-rush/meta";
import { sketchChainMeta } from "./sketch-chain/meta";
import { chompChompMeta } from "./chomp-chomp/meta";
import { fruitNinjaMeta } from "./fruit-ninja/meta";

export const games: GameMeta[] = [sketchChainMeta, flossRushMeta, chompChompMeta, fruitNinjaMeta];

export function getGameMeta(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id);
}

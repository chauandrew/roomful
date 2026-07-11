import type { GameMeta } from "@/lib/types";

export const majorityRulesMeta: GameMeta = {
  id: "majority-rules",
  name: "Majority Rules",
  description:
    "Everyone answers the same question on their phone — score a point by picking whatever the majority picks. Live tally on the big screen.",
  mode: "multi-user",
  minPlayers: 2,
  maxPlayers: 100,
  durationMinutes: 15,
  accent: "#34d399",
};

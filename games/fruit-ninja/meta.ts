import type { GameMeta } from "@/lib/types";

export const fruitNinjaMeta: GameMeta = {
  id: "fruit-ninja",
  name: "Fruit Ninja",
  description:
    "Two players, one camera: slice the flying fruit with your hands and dodge the bombs — one bomb ends it instantly. Four hands, three shared lives, 45 seconds.",
  mode: "single-device",
  minPlayers: 2,
  maxPlayers: 2,
  durationMinutes: 3,
  accent: "#4ade80",
};

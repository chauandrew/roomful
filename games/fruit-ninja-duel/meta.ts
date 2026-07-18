import type { GameMeta } from "@/lib/types";

export const fruitNinjaDuelMeta: GameMeta = {
  id: "fruit-ninja-duel",
  name: "Fruit Ninja Duel",
  description:
    "Two players, one camera, one winner: your side is green, theirs is blue. Slice more fruit than your rival in 45 seconds. Bombs cost you 5 fruit worth of points — steal from across the line if you dare.",
  mode: "single-device",
  minPlayers: 2,
  maxPlayers: 2,
  durationMinutes: 3,
  accent: "#a78bfa",
};

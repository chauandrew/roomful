import type { GameMeta } from "@/lib/types";

export const gibberishMeta: GameMeta = {
  id: "gibberish",
  name: "Gibberish",
  description:
    "Nonsense words that turn into a real phrase when you say them out loud. The room reads the screen, shouts guesses, and the host reveals the answer.",
  mode: "single-device",
  minPlayers: 1,
  maxPlayers: 500,
  durationMinutes: 10,
  accent: "#e0a92e",
};

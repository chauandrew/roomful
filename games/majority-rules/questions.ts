export interface Question {
  prompt: string;
  options: { id: string; label: string }[];
}

export const QUESTIONS: Question[] = [
  {
    prompt: "The best pizza is…",
    options: [
      { id: "thin", label: "Thin & crispy" },
      { id: "deep", label: "Deep dish" },
      { id: "ny", label: "Big floppy NY slice" },
      { id: "pineapple", label: "Whatever, as long as it has pineapple" },
    ],
  },
  {
    prompt: "You find $100 on the street. You…",
    options: [
      { id: "keep", label: "Keep it, obviously" },
      { id: "police", label: "Turn it in" },
      { id: "treat", label: "Buy everyone here a snack" },
    ],
  },
  {
    prompt: "Which superpower would this room choose?",
    options: [
      { id: "fly", label: "Flight" },
      { id: "invis", label: "Invisibility" },
      { id: "time", label: "Pause time" },
      { id: "minds", label: "Read minds" },
    ],
  },
  {
    prompt: "Cereal first or milk first?",
    options: [
      { id: "cereal", label: "Cereal first, like a normal person" },
      { id: "milk", label: "Milk first" },
      { id: "dry", label: "Dry cereal, no milk" },
    ],
  },
  {
    prompt: "The correct number of alarms in the morning is…",
    options: [
      { id: "one", label: "One. Discipline." },
      { id: "three", label: "2–3" },
      { id: "many", label: "A 20-minute wall of them" },
      { id: "none", label: "I wake up naturally" },
    ],
  },
  {
    prompt: "Best movie snack?",
    options: [
      { id: "popcorn", label: "Popcorn" },
      { id: "candy", label: "Candy" },
      { id: "nachos", label: "Nachos" },
      { id: "smuggled", label: "Whatever I smuggled in" },
    ],
  },
];

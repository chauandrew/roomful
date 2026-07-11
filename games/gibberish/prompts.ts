/**
 * Gibberish puzzles: read the nonsense out loud and a real phrase appears.
 * All puzzles are original — add your own, they're just pairs.
 */
export interface Puzzle {
  gibberish: string;
  answer: string;
}

export const PUZZLES: Puzzle[] = [
  { gibberish: "Sea Grit Age Bent", answer: "Secret Agent" },
  { gibberish: "Sand Tack Laws", answer: "Santa Claus" },
  { gibberish: "Bay King Sew Duh", answer: "Baking Soda" },
  { gibberish: "Moe Bile Foam", answer: "Mobile Phone" },
  { gibberish: "Thigh Tan Ick", answer: "Titanic" },
  { gibberish: "Hairy Pot Turr", answer: "Harry Potter" },
  { gibberish: "Bugs Bun Knee", answer: "Bugs Bunny" },
  { gibberish: "Eye Scream Sun Day", answer: "Ice Cream Sundae" },
  { gibberish: "Chick Ken New Dill Soup", answer: "Chicken Noodle Soup" },
  { gibberish: "Sup Her Mark Kit", answer: "Supermarket" },
  { gibberish: "Beau Ling Gal Lee", answer: "Bowling Alley" },
  { gibberish: "Canned He Cain", answer: "Candy Cane" },
  { gibberish: "Pea Knot Butt Turn Jell Lee", answer: "Peanut Butter and Jelly" },
  { gibberish: "Doe Knot Wear Ee Bee Hap Pea", answer: "Don't Worry, Be Happy" },
  { gibberish: "Roe Bought Vak Yume", answer: "Robot Vacuum" },
  { gibberish: "Toe Tall Lee Awk Word", answer: "Totally Awkward" },
];

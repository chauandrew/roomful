/**
 * Jackbox-style room codes: 4 uppercase letters, with easily-confused
 * characters (I, O) excluded so codes survive being shouted across a room.
 * Codes are ephemeral and collision-checked only by "does this PartyKit room
 * already have a host" — plenty for short-lived party sessions.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, no O

export const ROOM_CODE_LENGTH = 4;

export function generateRoomCode(): string {
  let code = "";
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((c) => ALPHABET.includes(c))
  );
}

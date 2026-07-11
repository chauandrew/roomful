/**
 * PartyKit host the browser connects to.
 * - Local dev: the partykit dev server on 127.0.0.1:1999 (default).
 * - Production: set NEXT_PUBLIC_PARTYKIT_HOST to your deployed party, e.g.
 *   "roomful.<your-partykit-username>.partykit.dev".
 */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";

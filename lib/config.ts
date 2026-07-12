/**
 * Room server host the browser connects to.
 * - Local dev: `wrangler dev` on 127.0.0.1:1999 (default).
 * - Production: set NEXT_PUBLIC_PARTYKIT_HOST to your deployed worker, e.g.
 *   "roomful.<your-subdomain>.workers.dev".
 */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";

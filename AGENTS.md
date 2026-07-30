<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Roomful project notes

- `npm run dev` starts BOTH Next.js (:3000) and PartyKit (:1999); `npm run typecheck` and `npm run lint` must pass before PRs.
- Adding a game never *requires editing* shared code: new folder under `games/<id>/` + registry entries in `games/registry.ts`, `games/clientRegistry.tsx`, and (multi-user only) `games/server-registry.ts` is always enough to plug one in. Using or extending existing `lib/` utilities (e.g. `lib/audio.ts`, `lib/tracking/`, `lib/leaderboard.ts`) is fine and expected once ≥2 games need the same thing — don't duplicate a whole file across games to avoid touching `lib/`. Full guide: docs/ADDING_A_GAME.md.
- Files bundled into the PartyKit worker (`party/`, `games/*/server.ts`, `games/server-registry.ts`, `games/types.ts`) must use relative imports and must not import React or browser APIs. Game reducers are pure functions.
- Clients only ever see `hostView`/`playerView` projections, never raw room state; per-player secrets belong in `playerView`.

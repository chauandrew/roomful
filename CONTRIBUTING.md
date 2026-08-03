# Contributing to Roomful

Thanks for helping build the party-game library! The codebase is deliberately
plugin-shaped: almost every contribution should be a new folder under
`games/`, not a change to shared code.

## Ground rules

- **New games**: follow [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md). A
  game PR should touch its own `games/<id>/` folder plus up to three
  one-line registry entries — if you find yourself editing
  `party/index.ts`, the routes, or the hooks, open an issue first; you've
  probably found either a missing platform primitive or an existing one you
  can reuse.
- **Platform changes** (new shared input component, new reducer helper,
  lobby improvements): welcome, but keep the room server game-agnostic.
  Anything game-specific belongs in a game's reducer or views.
- **Multi-user games need a second deploy after merge**: their reducer is
  bundled into the room server, which Vercel doesn't deploy. A maintainer has
  to run `npm run deploy:party` for the game to work in production (see
  [README](README.md#redeploying-after-a-change)). Nothing for you to do as a
  contributor, but don't be surprised if your merged game isn't live yet.
- **Server code stays pure**: files imported by
  `games/server-registry.ts` / `party/index.ts` must not import React or
  browser APIs, must use relative imports, and reducers must stay pure
  functions (no timers/IO) so they remain unit-testable.

## Dev workflow

```bash
npm install
npm run dev        # Next.js :3000 + PartyKit :1999
npm run typecheck
npm run lint
```

If your game has pure-logic unit tests (see e.g. `games/reflex-runner/*.test.ts`),
add a `test:<your-game>` script to `package.json` and a matching line in
`.github/workflows/ci.yml` and `.githooks/pre-push` — that's how the existing
games are wired up, there's no auto-discovery.

Playtest multi-user games with extra browser tabs as players (each tab is an
independent player thanks to per-tab sessionStorage), and check both screens:
the projector view from across the room, the player view on a narrow phone
viewport.

## Style

- TypeScript strict; no `any` outside the registry's erased generics.
- Tailwind for styling; use the game's accent via `var(--accent)` rather than
  hardcoding colors, so screens stay consistent.
- Keep projected screens bold and minimal — they compete with event lighting,
  not with the marketing homepage.

## Conduct

Be kind. Party games are supposed to be fun; so is contributing to them.

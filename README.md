# Roomful

Party games for a room full of people.

A host runs Roomful on a laptop, mirrors or projects it onto a big screen, and
leads the room through a growing library of party/icebreaker games. Games come
in two flavors:

- **Single-device** — everything happens on the projected screen; the host
  drives with keyboard/clicks and the crowd shouts along (e.g. **Floss Rush**).
- **Multi-user** — players join on their phones by scanning a QR code or
  typing a 4-letter room code. No accounts, no app — just a name. The laptop
  shows the shared view (e.g. **Sketch Chain**).

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Web app | Next.js (App Router) + TypeScript + Tailwind | Deploys to Vercel free tier |
| Realtime | [partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) on Cloudflare Workers/Durable Objects | Each room code is its own tiny stateful server — in-memory, ephemeral, WebSockets, free tier. Rooms die when everyone leaves, which is exactly what we want. No database. |

## Run it locally

```bash
npm install
npm run dev
```

That starts **two** processes (via `run-p`):

- Next.js on [http://localhost:3000](http://localhost:3000)
- The room server (`wrangler dev`) on `127.0.0.1:1999` (the browser connects to it directly)

Open <http://localhost:3000>, pick a game. For multi-user games, open the join
URL from the lobby in other browser tabs (or on phones on the same network —
use your machine's LAN IP instead of `localhost`) to play as players.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Homepage — all games as cards, filterable by mode |
| `/play/[gameId]` | Single-device games, fullscreen, keyboard-driven |
| `/host/[gameId]` | Multi-user host/projector view — room code + QR + lobby |
| `/join/[roomCode]` | Player view, phone-first — name form, then the game's input UI |

## Architecture in one paragraph

The room server ([party/index.ts](party/index.ts)) is completely
game-agnostic: it owns the lobby, player identity/reconnection, host identity,
and broadcasting. Each multi-user game plugs in a **pure reducer**
(`MultiUserGameLogic` in [games/types.ts](games/types.ts)): `init`,
`onHostAction`, `onPlayerInput`, plus two projections — `hostView` (what the
projector may show) and `playerView` (personalized per player, which is what
makes private prompts, chains, and asymmetric roles like spymasters possible).
Clients never see raw room state, only their projection. Simultaneous rounds,
sequential/chain rounds, and team/role games are all just different reducer
shapes — the platform assumes no game loop.

## Adding a game

See **[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)** for the full
walkthrough (both modes, round flows, input types). Short version: create a
folder under `games/`, then register it in up to three places:

1. [games/registry.ts](games/registry.ts) — metadata (always)
2. [games/clientRegistry.tsx](games/clientRegistry.tsx) — React components (always)
3. [games/server-registry.ts](games/server-registry.ts) — server logic (multi-user only)

No shared code changes needed.

## Deploying

Both halves deploy automatically on every push to `main`:

- **Room server** (realtime): the `deploy-party` job in
  [.github/workflows/ci.yml](.github/workflows/ci.yml) runs `wrangler deploy`
  after lint/typecheck/test/build pass, authenticated with a
  `CLOUDFLARE_API_TOKEN` repo secret.
- **Next.js** (UI): Vercel's own Git integration deploys on push.

First-time setup (one-time, by whoever owns the Cloudflare/Vercel accounts):

1. `npm run deploy:party` once locally (`wrangler login` on first run walks
   you through creating the free Cloudflare account). Note the deployed
   host, e.g. `roomful.<your-subdomain>.workers.dev`.
2. Add that same host as `NEXT_PUBLIC_PARTYKIT_HOST` in Vercel's env vars.
3. Add a Cloudflare API token as the `CLOUDFLARE_API_TOKEN` GitHub Actions
   secret so CI can deploy the worker on future merges.

Players never create accounts anywhere; only the deployer needs the two free
accounts.

## Contributing

PRs for new games are very welcome — that's the whole point of the plugin
design. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE). Contributions are accepted under the same terms.

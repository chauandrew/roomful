# Adding a game to Roomful

Every game lives in its own folder under `games/<your-game-id>/` and plugs
into the platform through registries. You never edit shared code
(`party/index.ts`, the routes, the hooks) to add a game.

Pick your mode first:

- **Single-device** — one React component, no server, no players' phones.
- **Multi-user** — a server-side reducer plus two React components
  (projector + phone). The platform gives you the lobby, QR join flow,
  reconnection, and end screen for free.

---

## 1. Single-device game

**Files** (see `games/speed-67/` for the reference):

```
games/my-game/
  meta.ts    — GameMeta (id, name, description, mode, accent, …)
  Play.tsx   — "use client" component, owns the whole screen
```

`Play.tsx` should render inside `PresenterLayout` (fullscreen, dark, your
accent color as `var(--accent)`) and put host controls in a `ControlBar`.
Bind keyboard shortcuts — hosts drive these games with a spacebar, not a
mouse.

**Register it** (2 lines):

1. `games/registry.ts` — add your meta to the `games` array.
2. `games/clientRegistry.tsx` — add `"my-game": { Play: dynamic(() => import("./my-game/Play")) }`.

Done. It appears on the homepage and is playable at `/play/my-game`.

---

## 2. Multi-user game

**Files** (see `games/majority-rules/` for simultaneous rounds,
`games/sketch-chain/` for sequential/chain rounds):

```
games/my-game/
  meta.ts         — GameMeta (minPlayers/maxPlayers matter here!)
  server.ts       — the game's MultiUserGameLogic reducer (NO React imports)
  HostView.tsx    — projector screen during play
  PlayerView.tsx  — phone screen during play
```

**Register it** (3 lines):

1. `games/registry.ts` — add your meta.
2. `games/clientRegistry.tsx` — add `HostView` + `PlayerView` dynamic imports.
3. `games/server-registry.ts` — add `{ meta, logic }` (use **relative**
   imports in server files; they're bundled by PartyKit, not Next).

### The reducer contract (`games/types.ts`)

```ts
interface MultiUserGameLogic<S, HostAction, PlayerInput> {
  init(players): S;                              // host pressed Start
  assignPlayers?(players): { [id]: {team, role} } // optional: teams/roles at start
  onHostAction(state, action, players): S;       // host control clicks
  onPlayerInput(state, playerId, input, players): S; // a phone submitted
  hostView(state, players): unknown;             // projector projection
  playerView(state, playerId, players): unknown; // per-player projection
}
```

Rules of thumb:

- **Pure functions only.** No timers, no IO, no React. Return new state
  (spread, don't mutate). This keeps games trivially unit-testable.
- **State is yours.** `S` can be anything JSON-serializable. Define your own
  internal phases (`"answering" | "revealed" | …`) — the platform only knows
  lobby/playing/ended.
- **Views are the security boundary.** Clients only ever receive what
  `hostView`/`playerView` return. Never put secrets in `hostView` (it's
  projected!); per-player secrets go in `playerView`.

### Simultaneous vs sequential rounds

Both are just reducer shapes:

- **Simultaneous** ("everyone answers at once"): keep a
  `submissions: Record<playerId, Input>` in state; accept input while your
  phase is collecting; let the host reveal via `onHostAction`, or
  auto-advance when `allSubmitted(playerIds, submissions)` (helper in
  `games/types.ts`). Reference: `majority-rules/server.ts`.
- **Sequential/chain** ("your output is my next input"): freeze the player
  order in `init`, keep `chains: Entry[][]`, and use
  `chainAssignments(playerIds, step)` (helper) to route chain → player each
  step — it guarantees every chain visits every player exactly once.
  Auto-advance the step when everyone submitted. Reference:
  `sketch-chain/server.ts`, including a `force-advance` host action to skip
  stragglers — real rooms have people who wander off.

### Teams and roles (asymmetric views)

Implement `assignPlayers` to give each player a `team`/`role` at game start
(e.g. split red/blue, pick one spymaster per team). They arrive back in every
reducer call via `players`, and each player sees their own in `view.you`.
Then just branch in `playerView` — e.g. include the secret grid only when
`players.find(p => p.id === playerId)?.role === "spymaster"`. That's the
entire mechanism; no platform support needed beyond the projection.

### Host actions

Your `HostView` gets `sendGameAction(action)` → your `onHostAction`, and
`sendHostAction({kind: "restart" | "end" | "kick"})` for platform actions.
Put controls in a `ControlBar` so they stay unobtrusive on the projector.

---

## 3. Input types on the phone

`PlayerView` receives `sendInput(input)` — send whatever your reducer
expects. Ready-made components in `components/inputs/`:

| Component | Emits | Use for |
| --- | --- | --- |
| `ChoiceInput` | option id(s) | single (tap = submit) or multi choice |
| `TextInput` | trimmed string | phrases, descriptions, free text |
| `DrawingCanvas` | PNG data URL | freehand drawing; render anywhere with `<img src={dataUrl}>` |

**Adding a new input type** (slider, photo, emoji-picker, map-pin…):

1. Build it as a dumb component in `components/inputs/` with an
   `onSubmit(value)` prop — no game or socket knowledge inside.
2. Keep the emitted value JSON-serializable and reasonably small (it rides
   the room's websocket to every relevant screen; the drawing canvas keeps
   PNGs ~10–60 KB as a guide).
3. Use it from any game's `PlayerView` and handle its value in that game's
   `onPlayerInput`. Nothing to register — input components are ordinary
   shared components.

---

## 4. Checklist before you PR

- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] Playtested locally with `npm run dev` + two extra browser tabs as players
- [ ] Refreshing the host tab mid-game reclaims the room; refreshing a player
      tab reclaims the seat (you get both for free — just don't key anything
      off connection identity, always use `playerId`)
- [ ] Projector screen readable from across a room (big type, high contrast,
      your accent color); phone screen has big tap targets
- [ ] `hostView` leaks no per-player secrets

/**
 * The Roomful room server. One instance of this class runs per room code
 * (PartyKit spins it up on first connection and tears it down when the last
 * connection closes — which is exactly the ephemeral lifetime we want).
 *
 * This file is deliberately game-agnostic. It owns:
 *   - room lifecycle (lobby → playing → ended)
 *   - player identity, joining, reconnection, kicking
 *   - host identity (a hostKey secret lets a refreshed host tab reclaim the room)
 *   - broadcasting personalized views (hostView / playerView projections)
 *
 * Everything game-specific happens inside the game's MultiUserGameLogic
 * reducer, looked up from games/server-registry.ts. To add a game you never
 * edit this file.
 */
import type * as Party from "partykit/server";
import type { ClientView, Player, RoomState } from "../lib/types";
import {
  parseClientMessage,
  type HostAction,
  type RoomErrorCode,
  type ServerMessage,
} from "../lib/protocol";
import { serverGames } from "../games/server-registry";

type ConnMeta = { role: "host" } | { role: "player"; playerId: string };

export default class RoomfulServer implements Party.Server {
  state: RoomState | null = null;
  hostKey: string | null = null;
  /** connection id → who is on the other end */
  conns = new Map<string, ConnMeta>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Player pages connect before the user has typed a name; tell them
    // immediately if the room doesn't exist so they see a clear error
    // instead of a name form for a dead room. Host pages create the room
    // via claim-host right after connecting, so they skip this check.
    const role = new URL(ctx.request.url).searchParams.get("role");
    if (role === "player" && !this.state) {
      this.sendError(conn, "room-not-found", "That room doesn't exist (or has ended).");
    }
  }

  onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    if (typeof raw !== "string") return;
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.sendError(sender, "bad-message", "Malformed message.");
      return;
    }

    switch (msg.type) {
      case "claim-host":
        this.claimHost(sender, msg.gameId, msg.hostKey);
        break;
      case "join":
        this.join(sender, msg.playerId, msg.name);
        break;
      case "host-action":
        if (this.conns.get(sender.id)?.role !== "host") {
          this.sendError(sender, "not-allowed", "Only the host can do that.");
          return;
        }
        this.handleHostAction(sender, msg.action);
        break;
      case "player-input":
        this.handlePlayerInput(sender, msg.input);
        break;
    }
  }

  onClose(conn: Party.Connection) {
    const meta = this.conns.get(conn.id);
    this.conns.delete(conn.id);
    if (!this.state || !meta) return;
    if (meta.role === "player") {
      // Keep the seat — phones lock, browsers background tabs. The player
      // reclaims it by rejoining with the same playerId (sessionStorage).
      const player = this.state.players.find((p) => p.id === meta.playerId);
      if (player) player.connected = false;
      this.broadcastSync();
    }
    // Host disconnect: keep the room alive so a refreshed host tab can
    // reclaim it with its hostKey. If everyone disconnects, PartyKit
    // disposes the room and its state — the ephemerality we want.
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  private claimHost(conn: Party.Connection, gameId: string, hostKey: string) {
    if (this.state && this.hostKey !== hostKey) {
      this.sendError(conn, "room-taken", "This room code is already in use.");
      return;
    }
    if (!this.state) {
      if (!serverGames[gameId]) {
        this.sendError(conn, "unknown-game", `No multi-user game "${gameId}".`);
        return;
      }
      this.state = {
        // Room ids are lowercased on connect (URL-safe); display uppercase.
        code: this.room.id.toUpperCase(),
        gameId,
        phase: "lobby",
        players: [],
        game: null,
      };
      this.hostKey = hostKey;
    }
    this.conns.set(conn.id, { role: "host" });
    this.broadcastSync();
  }

  private join(conn: Party.Connection, playerId: string, name: string) {
    if (!this.state) {
      this.sendError(conn, "room-not-found", "That room doesn't exist (or has ended).");
      return;
    }
    const { meta } = serverGames[this.state.gameId];
    const existing = this.state.players.find((p) => p.id === playerId);

    if (existing) {
      // Reconnection: reclaim the seat, even mid-game.
      existing.connected = true;
      if (name.trim()) existing.name = name.trim().slice(0, 20);
    } else {
      if (this.state.phase !== "lobby") {
        this.sendError(conn, "game-started", "This game already started — wait for the next one!");
        return;
      }
      if (this.state.players.length >= meta.maxPlayers) {
        this.sendError(conn, "room-full", "This room is full.");
        return;
      }
      const cleanName = name.trim().slice(0, 20) || "Anonymous";
      this.state.players.push({ id: playerId, name: cleanName, connected: true });
    }
    this.conns.set(conn.id, { role: "player", playerId });
    this.broadcastSync();
  }

  private handleHostAction(conn: Party.Connection, action: HostAction) {
    if (!this.state) return;
    const { meta, logic } = serverGames[this.state.gameId];

    switch (action.kind) {
      case "start": {
        // Disconnected lobby seats are pruned so chains/turn orders are
        // built only from people actually in the room.
        this.state.players = this.state.players.filter((p) => p.connected);
        if (this.state.players.length < meta.minPlayers) {
          this.sendError(
            conn,
            "not-allowed",
            `Need at least ${meta.minPlayers} players to start.`
          );
          return;
        }
        if (logic.assignPlayers) {
          const patches = logic.assignPlayers(this.state.players);
          for (const p of this.state.players) Object.assign(p, patches[p.id] ?? {});
        }
        this.state.game = logic.init(this.state.players);
        this.state.phase = "playing";
        break;
      }
      case "restart":
        this.state.phase = "lobby";
        this.state.game = null;
        for (const p of this.state.players) {
          delete p.team;
          delete p.role;
        }
        break;
      case "end":
        this.state.phase = "ended";
        break;
      case "kick": {
        this.state.players = this.state.players.filter((p) => p.id !== action.playerId);
        for (const [connId, meta2] of this.conns) {
          if (meta2.role === "player" && meta2.playerId === action.playerId) {
            this.room.getConnection(connId)?.close();
          }
        }
        break;
      }
      case "game":
        if (this.state.phase === "playing" && this.state.game !== null) {
          this.state.game = logic.onHostAction(
            this.state.game,
            action.action,
            this.state.players
          );
        }
        break;
    }
    this.broadcastSync();
  }

  private handlePlayerInput(conn: Party.Connection, input: unknown) {
    const meta = this.conns.get(conn.id);
    if (!this.state || meta?.role !== "player") return;
    if (this.state.phase !== "playing" || this.state.game === null) return;
    const { logic } = serverGames[this.state.gameId];
    this.state.game = logic.onPlayerInput(
      this.state.game,
      meta.playerId,
      input,
      this.state.players
    );
    this.broadcastSync();
  }

  // ── personalized broadcasting ──────────────────────────────────────────

  private buildView(meta: ConnMeta): ClientView {
    const s = this.state!;
    const { logic } = serverGames[s.gameId];
    const isHost = meta.role === "host";
    let game: unknown = null;
    if (s.phase === "playing" && s.game !== null) {
      game = isHost
        ? logic.hostView(s.game, s.players)
        : logic.playerView(s.game, (meta as { playerId: string }).playerId, s.players);
    }
    let you: Player | undefined;
    if (meta.role === "player") {
      you = s.players.find((p) => p.id === meta.playerId);
    }
    return {
      code: s.code,
      gameId: s.gameId,
      phase: s.phase,
      players: s.players,
      isHost,
      you: you && { id: you.id, name: you.name, team: you.team, role: you.role },
      game,
    };
  }

  private broadcastSync() {
    if (!this.state) return;
    for (const [connId, meta] of this.conns) {
      const conn = this.room.getConnection(connId);
      if (!conn) continue;
      const msg: ServerMessage = { type: "sync", view: this.buildView(meta) };
      conn.send(JSON.stringify(msg));
    }
  }

  private sendError(conn: Party.Connection, code: RoomErrorCode, message: string) {
    const msg: ServerMessage = { type: "error", code, message };
    conn.send(JSON.stringify(msg));
  }
}

RoomfulServer satisfies Party.Worker;

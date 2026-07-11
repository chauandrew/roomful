"use client";
/**
 * The one hook both host and player pages use to talk to a room.
 *
 * Handles identity persistence so refreshes are painless:
 *  - hosts keep a per-room secret (hostKey) in sessionStorage and reclaim
 *    the room on reconnect;
 *  - players keep a per-room playerId + name and reclaim their seat, even
 *    mid-game.
 */
import { useCallback, useState } from "react";
import usePartySocket from "partysocket/react";
import { PARTYKIT_HOST } from "@/lib/config";
import type { ClientView } from "@/lib/types";
import type { HostAction, RoomErrorCode, ServerMessage } from "@/lib/protocol";

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

interface UseRoomOptions {
  code: string;
  role: "host" | "player";
  /** Required for hosts: which game this room runs. */
  gameId?: string;
}

function sessionGet(key: string): string | null {
  return typeof window === "undefined" ? null : sessionStorage.getItem(key);
}
function sessionSet(key: string, value: string) {
  if (typeof window !== "undefined") sessionStorage.setItem(key, value);
}

export function useRoom({ code, role, gameId }: UseRoomOptions) {
  const [view, setView] = useState<ClientView | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [connected, setConnected] = useState(false);
  // Whether this player has ever joined this room (name saved in
  // sessionStorage) — drives the name-form-vs-connecting UI on refresh.
  const [hasJoined, setHasJoined] = useState(
    () => sessionGet(`roomful:name:${code}`) !== null
  );

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: code.toLowerCase(),
    query: { role },
    onOpen() {
      setConnected(true);
      if (role === "host" && gameId) {
        let hostKey = sessionGet(`roomful:hostkey:${code}`);
        if (!hostKey) {
          hostKey = crypto.randomUUID();
          sessionSet(`roomful:hostkey:${code}`, hostKey);
        }
        send({ type: "claim-host", gameId, hostKey });
      }
      if (role === "player") {
        // Auto-rejoin with the saved name (reconnect or page refresh).
        const savedName = sessionGet(`roomful:name:${code}`);
        if (savedName) {
          send({ type: "join", playerId: getPlayerId(code), name: savedName });
        }
      }
    },
    onClose() {
      setConnected(false);
    },
    onMessage(event) {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      if (msg.type === "sync") {
        setView(msg.view);
        setError(null);
      } else if (msg.type === "error") {
        setError({ code: msg.code, message: msg.message });
      }
    },
  });

  function send(msg: object) {
    socket.send(JSON.stringify(msg));
  }

  /** Player: join (or rejoin) the room with a display name. */
  const join = useCallback(
    (name: string) => {
      setHasJoined(true);
      sessionSet(`roomful:name:${code}`, name);
      socket.send(
        JSON.stringify({ type: "join", playerId: getPlayerId(code), name })
      );
    },
    [socket, code]
  );

  /** Host: platform-level controls (start / restart / end / kick). */
  const sendHostAction = useCallback(
    (action: HostAction) => {
      socket.send(JSON.stringify({ type: "host-action", action }));
    },
    [socket]
  );

  /** Host: forward a game-defined action to the game's reducer. */
  const sendGameAction = useCallback(
    (action: unknown) => sendHostAction({ kind: "game", action }),
    [sendHostAction]
  );

  /** Player: submit input for the current round. */
  const sendInput = useCallback(
    (input: unknown) => {
      socket.send(JSON.stringify({ type: "player-input", input }));
    },
    [socket]
  );

  return {
    view,
    error,
    connected,
    hasJoined,
    join,
    sendHostAction,
    sendGameAction,
    sendInput,
  };
}

function getPlayerId(code: string): string {
  const key = `roomful:pid:${code}`;
  let id = sessionGet(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionSet(key, id);
  }
  return id;
}

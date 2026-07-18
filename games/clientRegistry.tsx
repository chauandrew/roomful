"use client";
/**
 * Maps game ids to their React components, loaded lazily so a player's
 * phone only downloads the game actually being played.
 *
 * Single-device games register { Play }.
 * Multi-user games register { HostView, PlayerView }.
 *
 * (This lives apart from registry.ts because component maps are client-only,
 * while the meta list must stay importable from server components.)
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { HostViewProps, PlayerViewProps } from "./clientTypes";

export interface GameComponents {
  Play?: ComponentType;
  HostView?: ComponentType<HostViewProps>;
  PlayerView?: ComponentType<PlayerViewProps>;
}

export const gameComponents: Record<string, GameComponents> = {
  "sketch-chain": {
    HostView: dynamic(() => import("./sketch-chain/HostView")),
    PlayerView: dynamic(() => import("./sketch-chain/PlayerView")),
  },
  "floss-rush": {
    // ssr:false required — usePoseTracking touches navigator.mediaDevices,
    // which doesn't exist during server-side rendering.
    Play: dynamic(() => import("./floss-rush/Play"), { ssr: false }),
  },
  "chomp-chomp": {
    // ssr:false required — useFaceTracking touches navigator.mediaDevices,
    // which doesn't exist during server-side rendering.
    Play: dynamic(() => import("./chomp-chomp/Play"), { ssr: false }),
  },
  "fruit-ninja": {
    // ssr:false required — useHandTracking touches navigator.mediaDevices,
    // which doesn't exist during server-side rendering.
    Play: dynamic(() => import("./fruit-ninja/Play"), { ssr: false }),
  },
  "fruit-ninja-duel": {
    // ssr:false required — useHandTracking touches navigator.mediaDevices,
    // which doesn't exist during server-side rendering.
    Play: dynamic(() => import("./fruit-ninja-duel/Play"), { ssr: false }),
  },
};

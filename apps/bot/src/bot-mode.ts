import { DEFAULT_MIN_PLAYERS, DEV_MIN_PLAYERS } from "@grimkeeper/engine";

import { isDevMode } from "./dev.js";

export const MINIMAL_MIN_PLAYERS = 7;

export function isMinimalMode(): boolean {
  return process.env.BOT_MODE === "minimal";
}

export function minPlayersForMode(): number {
  if (isMinimalMode()) {
    return MINIMAL_MIN_PLAYERS;
  }
  return isDevMode() ? DEV_MIN_PLAYERS : DEFAULT_MIN_PLAYERS;
}

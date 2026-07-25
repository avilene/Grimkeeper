import type { Client } from "discord.js";
import {
  clearDiscordNomsRefreshRequest,
  listGamesPendingDiscordNomsRefresh,
} from "@grimkeeper/database";

import { loadEngine } from "./commands/command-context.js";
import { getBotClient } from "./discord-client.js";
import { reportError } from "./error-reporter.js";
import { log } from "./logger.js";
import { refreshNominationsFromProjection } from "./refresh-noms-from-projection.js";

let processing = false;

export async function processPendingDiscordNomsRefresh(client?: Client): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const bot = client ?? getBotClient();
    if (!bot) return;
    const pending = await listGamesPendingDiscordNomsRefresh(5);
    for (const game of pending) {
      const requestedAt = game.discordNomsRefreshRequestedAt;
      if (!requestedAt) continue;
      try {
        const guild = await bot.guilds.fetch(game.guildId).catch(() => null);
        if (!guild) {
          await clearDiscordNomsRefreshRequest(game.id, requestedAt);
          continue;
        }
        const engine = await loadEngine(game.id);
        const result = await refreshNominationsFromProjection(guild, game, engine);
        await clearDiscordNomsRefreshRequest(game.id, requestedAt);
        log("info", "discord.noms.refresh.done", {
          gameId: game.id,
          appended: result.appended,
          posted: result.posted,
          total: result.total,
        });
      } catch (error) {
        void reportError("discord.noms.refresh.failed", error, { gameId: game.id });
        // Leave the flag set so a later tick can retry.
      }
    }
  } finally {
    processing = false;
  }
}

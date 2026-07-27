import type { Client } from "discord.js";
import {
  clearDiscordKibNomsRepostRequest,
  clearDiscordNomsRefreshRequest,
  clearDiscordPingMissingRequest,
  listGamesPendingDiscordKibNomsRepost,
  listGamesPendingDiscordNomsRefresh,
  listGamesPendingDiscordPingMissing,
} from "@grimkeeper/database";

import { repostOpenNominationsToKib } from "./bulk-nomination-actions.js";
import { loadEngine } from "./commands/command-context.js";
import { getBotClient } from "./discord-client.js";
import { reportError } from "./error-reporter.js";
import { pingMissingVoters } from "./interactions/lock-votes.js";
import { log } from "./logger.js";
import { refreshNominationsFromProjection } from "./refresh-noms-from-projection.js";

let processingRefresh = false;
let processingKibRepost = false;
let processingPingMissing = false;

export async function processPendingDiscordNomsRefresh(client?: Client): Promise<void> {
  if (processingRefresh) return;
  processingRefresh = true;
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
          missing: result.missing,
          posted: result.posted,
          total: result.total,
          votingChannelId: result.votingChannelId,
        });
      } catch (error) {
        void reportError("discord.noms.refresh.failed", error, { gameId: game.id });
        // Leave the flag set so a later tick can retry.
      }
    }
  } finally {
    processingRefresh = false;
  }
}

export async function processPendingDiscordKibNomsRepost(client?: Client): Promise<void> {
  if (processingKibRepost) return;
  processingKibRepost = true;
  try {
    const bot = client ?? getBotClient();
    if (!bot) return;
    const pending = await listGamesPendingDiscordKibNomsRepost(5);
    for (const game of pending) {
      const requestedAt = game.discordKibNomsRepostRequestedAt;
      if (!requestedAt) continue;
      try {
        const guild = await bot.guilds.fetch(game.guildId).catch(() => null);
        if (!guild) {
          await clearDiscordKibNomsRepostRequest(game.id, requestedAt);
          continue;
        }
        const engine = await loadEngine(game.id);
        const result = await repostOpenNominationsToKib(guild, game, engine);
        await clearDiscordKibNomsRepostRequest(game.id, requestedAt);
        log("info", "discord.noms.kibRepost.done", {
          gameId: game.id,
          posted: result.posted,
          deleted: result.deleted,
        });
      } catch (error) {
        void reportError("discord.noms.kibRepost.failed", error, { gameId: game.id });
      }
    }
  } finally {
    processingKibRepost = false;
  }
}

export async function processPendingDiscordPingMissing(client?: Client): Promise<void> {
  if (processingPingMissing) return;
  processingPingMissing = true;
  try {
    const bot = client ?? getBotClient();
    if (!bot) return;
    const pending = await listGamesPendingDiscordPingMissing(5);
    for (const game of pending) {
      const requestedAt = game.discordPingMissingRequestedAt;
      const nominationId = game.discordPingMissingNominationId;
      if (!requestedAt || !nominationId) continue;
      try {
        const guild = await bot.guilds.fetch(game.guildId).catch(() => null);
        if (!guild) {
          await clearDiscordPingMissingRequest(game.id, requestedAt);
          continue;
        }
        const engine = await loadEngine(game.id);
        const message = await pingMissingVoters(guild, game, engine, nominationId);
        await clearDiscordPingMissingRequest(game.id, requestedAt);
        log("info", "discord.noms.pingMissing.done", {
          gameId: game.id,
          nominationId,
          message,
        });
      } catch (error) {
        void reportError("discord.noms.pingMissing.failed", error, {
          gameId: game.id,
          nominationId,
        });
      }
    }
  } finally {
    processingPingMissing = false;
  }
}

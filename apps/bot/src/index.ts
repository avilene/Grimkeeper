import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

import "./bootstrap-logs.js";

import "reflect-metadata";
import { Events, IntentsBitField } from "discord.js";
import { Client } from "discordx";

import { isMinimalMode } from "./bot-mode.js";
import { setBotClient } from "./discord-client.js";
import {
  flushDiscordReports,
  registerClientErrorHandlers,
  reportError,
} from "./error-reporter.js";
import { loadCommandModules } from "./load-commands.js";
import { log } from "./logger.js";
import { startReminderScheduler } from "./reminder-scheduler.js";

await loadCommandModules();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required. Copy .env.example to .env and fill it in.");
}

const client = new Client({
  botId: process.env.DISCORD_CLIENT_ID,
  intents: [IntentsBitField.Flags.Guilds],
  silent: false,
  simpleCommand: {
    prefix: "!",
  },
});

registerClientErrorHandlers(client);

client.once(Events.ClientReady, async () => {
  setBotClient(client);
  if (!isMinimalMode()) {
    startReminderScheduler(client);
  }
  try {
    await client.initApplicationCommands();
    log("info", "commands.register.ok", { botMode: isMinimalMode() ? "minimal" : "full" });
  } catch (error) {
    await reportError("commands.register.failed", error, { botMode: isMinimalMode() ? "minimal" : "full" });
  }
  await flushDiscordReports(client);
  log("info", "bot.ready", { tag: client.user?.tag, id: client.user?.id, botMode: isMinimalMode() ? "minimal" : "full" });
});

client.on("interactionCreate", (interaction) => {
  void (async () => {
    if (!isMinimalMode()) {
      const { handleVoteButton, handleVoteModalSubmit } = await import("./interactions/day-vote.js");
      if (interaction.isButton()) {
        const handled = await handleVoteButton(interaction);
        if (handled) return;
      }
      if (interaction.isModalSubmit()) {
        const handled = await handleVoteModalSubmit(interaction);
        if (handled) return;
      }
    }
    await client.executeInteraction(interaction);
  })().catch((error: unknown) => {
    void reportError("interaction.failed", error, {
      command: interaction.isChatInputCommand() ? interaction.commandName : interaction.type,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });
  });
});

try {
  await client.login(token);
} catch (error) {
  await reportError("discord.login.failed", error);
  process.exit(1);
}

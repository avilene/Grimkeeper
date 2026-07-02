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

import { GameCommands } from "./commands/game.js";
import { log, logError } from "./logger.js";

void GameCommands;

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required. Copy .env.example to .env and fill it in.");
}

const client = new Client({
  botId: process.env.DISCORD_CLIENT_ID,
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
  silent: false,
  simpleCommand: {
    prefix: "!",
  },
});

client.once(Events.ClientReady, async () => {
  await client.initApplicationCommands();
  log("info", "bot.ready", { tag: client.user?.tag, id: client.user?.id });
});

client.on("interactionCreate", (interaction) => {
  void Promise.resolve(client.executeInteraction(interaction)).catch((error: unknown) => {
    logError("error", "interaction.failed", error, {
      command: interaction.isChatInputCommand() ? interaction.commandName : interaction.type,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });
  });
});

await client.login(token);

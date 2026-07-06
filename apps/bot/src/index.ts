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

import { DevCommands } from "./commands/dev.js";
import { DevCommandsMinimal } from "./commands/dev-minimal.js";
import { GameCommands } from "./commands/game.js";
import { GameCommandsMinimal } from "./commands/game-minimal.js";
import { StCommands } from "./commands/st.js";
import { StCommandsMinimal } from "./commands/st-minimal.js";
import { setBotClient } from "./discord-client.js";
import {
  flushDiscordReports,
  registerClientErrorHandlers,
  reportError,
} from "./error-reporter.js";
import { handleVoteButton, handleVoteModalSubmit } from "./interactions/day-vote.js";
import { log } from "./logger.js";
import { startReminderScheduler } from "./reminder-scheduler.js";
import { isMinimalMode } from "./bot-mode.js";

if (isMinimalMode()) {
  void GameCommandsMinimal;
  void StCommandsMinimal;
  void DevCommandsMinimal;
} else {
  void GameCommands;
  void StCommands;
  void DevCommands;
}

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
  } catch (error) {
    await reportError("commands.register.failed", error);
  }
  await flushDiscordReports(client);
  log("info", "bot.ready", { tag: client.user?.tag, id: client.user?.id });
});

client.on("interactionCreate", (interaction) => {
  void (async () => {
    if (interaction.isButton()) {
      if (!isMinimalMode()) {
        const handled = await handleVoteButton(interaction);
        if (handled) return;
      }
    }
    if (interaction.isModalSubmit()) {
      if (!isMinimalMode()) {
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

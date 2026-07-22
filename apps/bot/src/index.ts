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

import { setBotClient } from "./discord-client.js";
import {
  flushDiscordReports,
  notifyLifecycle,
  registerClientErrorHandlers,
  reportError,
} from "./error-reporter.js";
import { loadCommandModules } from "./load-commands.js";
import { log } from "./logger.js";
import { startEarlyDefer } from "./interactions/early-defer.js";
import { isRecoverableInteractionResponseError } from "./interactions/interaction-response.js";
import { tryMarkInteractionOnce } from "./interactions/interaction-dedup.js";
import { logCommandInvoked } from "./action-log.js";
import { startReminderScheduler } from "./reminder-scheduler.js";

await loadCommandModules();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required. Copy .env.example to .env and fill it in.");
}

const stQueueEnabled = Boolean(process.env.ST_QUEUE_THREAD_ID?.trim());

const client = new Client({
  botId: process.env.DISCORD_CLIENT_ID,
  // GuildMessages is only needed for ST queue image-attach collection.
  intents: stQueueEnabled
    ? [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages]
    : [IntentsBitField.Flags.Guilds],
  silent: false,
  simpleCommand: {
    prefix: "!",
  },
});

registerClientErrorHandlers(client);

client.once(Events.ClientReady, async () => {
  setBotClient(client);
  startReminderScheduler(client);
  let commandsRegistered = false;
  try {
    await client.initApplicationCommands();
    commandsRegistered = true;
    log("info", "commands.register.ok", { botMode: "minimal" });
  } catch (error) {
    await reportError("commands.register.failed", error, { botMode: "minimal" });
  }

  if (stQueueEnabled) {
    try {
      const { refreshQueuePanel } = await import("./st-queue-board.js");
      for (const [, guild] of client.guilds.cache) {
        await refreshQueuePanel(guild).catch(() => undefined);
      }
      log("info", "stQueue.panel.refresh.ok");
    } catch (error) {
      void reportError("stQueue.panel.refresh.failed", error);
    }
  }

  await notifyLifecycle(
    "bot.started",
    {
      tag: client.user?.tag,
      id: client.user?.id,
      botMode: "minimal",
      commandsRegistered,
      deployTrigger: process.env.DEPLOY_TRIGGER ?? "unknown",
      image: process.env.GRIMKEEPER_IMAGE,
      hostname: process.env.HOSTNAME,
    },
    client,
  );
  await flushDiscordReports(client);
  log("info", "bot.ready", { tag: client.user?.tag, id: client.user?.id, botMode: "minimal" });
});

client.on("interactionCreate", (interaction) => {
  if (!tryMarkInteractionOnce(interaction.id)) return;

  const deferTask = startEarlyDefer(interaction);

  void (async () => {
    await deferTask;
    logCommandInvoked(interaction);

    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu()) {
      const { handleVoteButton, handleVoteModalSubmit } = await import("./interactions/day-vote.js");
      const { handleLockVotesButton } = await import("./interactions/lock-votes.js");
      const { handleStPanelButton, handleStPanelUserSelect } = await import(
        "./interactions/st-panel.js"
      );
      // Only load/process ST queue interactions when ST_QUEUE_THREAD_ID is set.
      const queueHandlers = stQueueEnabled
        ? await import("./interactions/st-queue.js")
        : null;
      if (interaction.isButton()) {
        if (queueHandlers) {
          const handledQueue = await queueHandlers.handleStQueueButton(interaction);
          if (handledQueue) return;
        }
        const handledPanel = await handleStPanelButton(interaction);
        if (handledPanel) return;
        const handledLock = await handleLockVotesButton(interaction);
        if (handledLock) return;
        const handled = await handleVoteButton(interaction);
        if (handled) return;
      }
      if (interaction.isUserSelectMenu()) {
        if (queueHandlers) {
          const handledQueue = await queueHandlers.handleStQueueUserSelect(interaction);
          if (handledQueue) return;
        }
        const handled = await handleStPanelUserSelect(interaction);
        if (handled) return;
      }
      if (interaction.isModalSubmit()) {
        if (queueHandlers) {
          const handledQueue = await queueHandlers.handleStQueueModalSubmit(interaction);
          if (handledQueue) return;
        }
        const handled = await handleVoteModalSubmit(interaction);
        if (handled) return;
      }
    }
    await client.executeInteraction(interaction);
  })().catch((error: unknown) => {
    const recoverable =
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === 10062 || isRecoverableInteractionResponseError(error));

    const context = {
      command: interaction.isChatInputCommand() ? interaction.commandName : interaction.type,
      subcommandGroup: interaction.isChatInputCommand()
        ? interaction.options.getSubcommandGroup(false) ?? undefined
        : undefined,
      subcommand: interaction.isChatInputCommand()
        ? interaction.options.getSubcommand(false) ?? undefined
        : undefined,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    };

    if (recoverable) {
      // Still surface to the error channel — these often explain "hanging" commands
      // (expired token, duplicate bot ack, etc.).
      void reportError("interaction.recoverable", error, context);
      return;
    }
    void reportError("interaction.failed", error, context);
  });
});

try {
  await client.login(token);
} catch (error) {
  await reportError("discord.login.failed", error);
  process.exit(1);
}

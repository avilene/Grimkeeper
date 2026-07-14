import { type ChatInputCommandInteraction, Interaction, MessageFlags } from "discord.js";

import { isMinimalMode } from "../bot-mode.js";
import { isInteractionAlreadyAcknowledged } from "./interaction-response.js";
import { log } from "../logger.js";

const ST_REMINDER_SUBCOMMANDS = new Set([
  "remind",
  "set-reminders",
  "reminders",
  "clear-reminders",
  "delete-reminder",
]);

const INTERACTION_DEFER_BUDGET_MS = 2_800;

export function shouldDeferStSlashCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "st") return false;

  if (isMinimalMode()) return true;

  const subcommand = interaction.options.getSubcommand(false);
  return subcommand !== null && ST_REMINDER_SUBCOMMANDS.has(subcommand);
}

/** @deprecated Use startEarlyDefer */
export function shouldDeferStReminderCommand(interaction: Interaction): boolean {
  return shouldDeferStSlashCommand(interaction);
}

/** Kick off deferReply on the same tick the interaction arrives. */
export function startEarlyDefer(interaction: Interaction): Promise<void> {
  if (!shouldDeferStSlashCommand(interaction)) return Promise.resolve();

  const command = interaction as ChatInputCommandInteraction;
  if (command.deferred || command.replied) return Promise.resolve();

  const ageMs = Date.now() - command.createdTimestamp;
  if (ageMs > INTERACTION_DEFER_BUDGET_MS) {
    log("warn", "interaction.defer.late", {
      ageMs,
      command: command.commandName,
      subcommand: command.options.getSubcommand(false) ?? undefined,
      guildId: command.guildId,
      channelId: command.channelId,
      userId: command.user.id,
    });
  }

  return command.deferReply({ flags: MessageFlags.Ephemeral }).then(
    () => undefined,
    (error: unknown) => {
      if (isInteractionAlreadyAcknowledged(error)) {
        return undefined;
      }
      log("warn", "interaction.defer.failed", {
        command: command.commandName,
        subcommand: command.options.getSubcommand(false) ?? undefined,
        guildId: command.guildId,
        channelId: command.channelId,
        userId: command.user.id,
        ageMs,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

export async function deferStReminderCommand(interaction: Interaction): Promise<void> {
  await startEarlyDefer(interaction);
}

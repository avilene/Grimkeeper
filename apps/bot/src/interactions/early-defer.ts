import { type ChatInputCommandInteraction, Interaction, MessageFlags } from "discord.js";

import { isMinimalMode } from "../bot-mode.js";

const ST_REMINDER_SUBCOMMANDS = new Set([
  "remind",
  "set-reminders",
  "reminders",
  "clear-reminders",
  "delete-reminder",
]);

export function shouldDeferStReminderCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "st") return false;

  if (isMinimalMode()) return true;

  const subcommand = interaction.options.getSubcommand(false);
  return subcommand !== null && ST_REMINDER_SUBCOMMANDS.has(subcommand);
}

export async function deferStReminderCommand(interaction: Interaction): Promise<void> {
  if (!shouldDeferStReminderCommand(interaction)) return;

  const command = interaction as ChatInputCommandInteraction;
  if (command.deferred || command.replied) return;

  await command.deferReply({ flags: MessageFlags.Ephemeral });
}

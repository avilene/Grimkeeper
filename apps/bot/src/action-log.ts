import type { Interaction } from "discord.js";

import { log } from "./logger.js";

export function logCommandInvoked(interaction: Interaction): void {
  if (!interaction.isChatInputCommand()) return;

  log("info", "command.invoked", {
    command: interaction.commandName,
    subcommandGroup: interaction.options.getSubcommandGroup(false) ?? undefined,
    subcommand: interaction.options.getSubcommand(false) ?? undefined,
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId ?? undefined,
    userId: interaction.user.id,
  });
}

export function logReminderAction(
  action: "created" | "fired" | "cancelled" | "listed" | "updated",
  fields: Record<string, unknown>,
): void {
  log("info", `reminder.${action}`, fields);
}

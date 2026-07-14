import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  Role,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  cancelReminders,
  countPendingReminders,
  createReminder,
  listPendingReminders,
} from "@grimkeeper/database";

import { getReminderPingRoleId } from "../access.js";
import { formatReminderDuration, parseReminderDuration, parseReminderHours } from "../reminder-duration.js";
import { discordTimestamp } from "../reminder-message.js";
import { requireReminderAccess } from "./command-context.js";

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StReminderCommands {
  @Slash({ name: "remind", description: "Schedule a reminder message in the day thread or town channel" })
  async remind(
    @SlashOption({
      name: "in",
      description: "When to send the reminder (e.g. 5m, 10, 1h)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    inDuration: string,
    @SlashOption({
      name: "message",
      description: "Reminder text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    message: string,
    @SlashOption({
      name: "channel",
      description: "Where to post the reminder",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    channel: "day" | "town" | undefined,
    @SlashOption({
      name: "ping_role",
      description: "Role to ping (channel reminders; defaults to REMINDER_PING_ROLE_ID)",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    pingRole: Role | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    const access = await requireReminderAccess(interaction);
    if (!access) return;
    if (!interaction.guildId) return;

    const { scope, game, engine, targetChannelId } = access;
    const minutes = parseReminderDuration(inDuration);
    if (!minutes) {
      await interaction.reply({
        content: "Duration must be like `5m`, `10`, or `1h` (max 24h).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let reminderChannelId = targetChannelId;
    let where = `<#${targetChannelId}>`;
    if (scope.kind === "game" && game && engine) {
      const dayThreadId = engine.getState().day?.discordThreadId;
      reminderChannelId =
        channel === "town" || !dayThreadId ? game.channelId : dayThreadId;
      where = channel === "town" || !dayThreadId ? "town" : `<#${dayThreadId}>`;
    }

    const fireAt = new Date(Date.now() + minutes * 60_000);
    const pingRoleId = pingRole?.id ?? (scope.kind === "channel" ? getReminderPingRoleId() : null);

    if (scope.kind === "channel" && !pingRoleId) {
      await interaction.reply({
        content: "Provide a `ping_role` or set `REMINDER_PING_ROLE_ID` for channel reminders.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await createReminder({
      gameId: scope.kind === "game" ? scope.gameId : null,
      guildId: interaction.guildId,
      channelId: reminderChannelId,
      message: message.trim(),
      fireAt,
      createdBy: interaction.user.id,
      pingPlayers: Boolean(pingRoleId),
      pingRoleId: pingRoleId ?? null,
    });

    const pingNote = pingRoleId ? `, pinging <@&${pingRoleId}>` : "";
    await interaction.reply({
      content: `Reminder set in ${formatReminderDuration(minutes)} for ${where}${pingNote}: “${message.trim()}”`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "set-reminders",
    description: "Schedule multiple hour-offset reminders in this channel with player pings",
  })
  async setReminders(
    @SlashOption({
      name: "message",
      description: "Reminder text sent with each ping",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    message: string,
    @SlashOption({
      name: "hours",
      description: "Space-separated hours from now (e.g. 4 8 12 16 20 22 23 24)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    hoursInput: string,
    @SlashOption({
      name: "ping_role",
      description: "Role to ping (channel reminders; defaults to REMINDER_PING_ROLE_ID or game players role)",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    pingRole: Role | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    const access = await requireReminderAccess(interaction);
    if (!access) return;
    if (!interaction.guildId) return;

    const { scope, targetChannelId } = access;
    const hours = parseReminderHours(hoursInput);
    if (!hours) {
      await interaction.reply({
        content:
          "Hours must be space-separated integers from 1–24 (e.g. `4 8 12 16 20 22 23 24`), max 25 offsets.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (scope.kind === "channel") {
      const channelPingRoleId = pingRole?.id ?? getReminderPingRoleId();
      if (!channelPingRoleId) {
        await interaction.reply({
          content: "Provide a `ping_role` or set `REMINDER_PING_ROLE_ID` for channel reminders.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const trimmedMessage = message.trim();
    const now = Date.now();
    const createdInThread = interaction.channel?.isThread() ?? false;
    const pingRoleId = pingRole?.id ?? (scope.kind === "channel" ? getReminderPingRoleId() : null);

    await Promise.all(
      hours.map((hour) =>
        createReminder({
          gameId: scope.kind === "game" ? scope.gameId : null,
          guildId: interaction.guildId!,
          channelId: targetChannelId,
          message: trimmedMessage,
          fireAt: new Date(now + hour * 3_600_000),
          createdBy: interaction.user.id,
          pingPlayers: true,
          pingRoleId: pingRoleId ?? null,
        }),
      ),
    );

    const scheduleLines = hours.map((hour) => {
      const fireAt = new Date(now + hour * 3_600_000);
      return `- ${discordTimestamp(fireAt, "R")} (${discordTimestamp(fireAt, "t")})`;
    });
    const totalPending = await countPendingReminders(scope);
    const scopeLabel = scope.kind === "game" ? "this game" : `<#${targetChannelId}>`;
    const threadNote = createdInThread ? " (created in thread, fires in parent channel)" : "";
    const pingLabel = pingRoleId ? `<@&${pingRoleId}>` : "player role";

    await interaction.reply({
      content: [
        `Set **${hours.length}** reminder${hours.length === 1 ? "" : "s"} in <#${targetChannelId}> pinging ${pingLabel}${threadNote}:`,
        `“${trimmedMessage}”`,
        "",
        ...scheduleLines,
        "",
        `**${totalPending}** reminder${totalPending === 1 ? "" : "s"} pending for ${scopeLabel}. Run again anytime to add more.`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "reminders", description: "List pending reminders for this game or channel" })
  async reminders(interaction: CommandInteraction): Promise<void> {
    const access = await requireReminderAccess(interaction);
    if (!access) return;

    const { scope } = access;
    const pending = await listPendingReminders(scope);
    if (pending.length === 0) {
      await interaction.reply({ content: "No pending reminders.", flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = pending.map((reminder) => {
      const when = discordTimestamp(reminder.fireAt, "R");
      const pingNote = reminder.pingPlayers
        ? reminder.pingRoleId
          ? ` (pings <@&${reminder.pingRoleId}>)`
          : " (pings players)"
        : "";
      return `- \`${reminder.id.slice(0, 8)}\` ${when} in <#${reminder.channelId}>${pingNote}: ${reminder.message}`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Pending reminders")
          .setDescription(
            `${lines.join("\n")}\n\nDelete one with \`/st delete-reminder id:<prefix>\` or clear with \`/st clear-reminders\`.`,
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "clear-reminders", description: "Cancel pending reminders for this game or channel" })
  async clearReminders(
    @SlashChoice({ name: "All pending", value: "all" })
    @SlashChoice({ name: "This channel only", value: "channel" })
    @SlashChoice({ name: "Matching message", value: "message" })
    @SlashOption({
      name: "scope",
      description: "Which reminders to cancel",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    scope: "all" | "channel" | "message",
    @SlashOption({
      name: "message",
      description: "Exact message text (required when scope is message)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    const access = await requireReminderAccess(interaction);
    if (!access) return;

    const { scope: reminderScope, targetChannelId } = access;
    if (scope === "message" && !message?.trim()) {
      await interaction.reply({
        content: "Provide the `message` option when using scope `message`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (scope === "channel" && !interaction.channelId) {
      await interaction.reply({
        content: "This command must be used in a channel or thread when scope is `channel`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cancelled = await cancelReminders(
      reminderScope,
      scope === "all"
        ? undefined
        : scope === "channel"
          ? { channelId: targetChannelId }
          : { message: message!.trim() },
    );

    const remaining = await countPendingReminders(reminderScope);
    await interaction.reply({
      content:
        cancelled === 0
          ? "No matching pending reminders to cancel."
          : `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"}. **${remaining}** still pending.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "delete-reminder", description: "Cancel one pending reminder by ID prefix" })
  async deleteReminder(
    @SlashOption({
      name: "id",
      description: "ID prefix from /st reminders (e.g. first 8 characters)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    idPrefix: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    const access = await requireReminderAccess(interaction);
    if (!access) return;

    const { scope: reminderScope } = access;
    const trimmedId = idPrefix.trim();
    if (!trimmedId) {
      await interaction.reply({ content: "Provide a reminder ID prefix.", flags: MessageFlags.Ephemeral });
      return;
    }

    const cancelled = await cancelReminders(reminderScope, { idPrefix: trimmedId });
    if (cancelled === 0) {
      await interaction.reply({
        content: `No pending reminder found with ID prefix \`${trimmedId}\`. Check \`/st reminders\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const remaining = await countPendingReminders(reminderScope);
    await interaction.reply({
      content: `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"}. **${remaining}** still pending.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

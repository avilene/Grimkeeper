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
  cancelReminderByIdPrefix,
  countPendingReminders,
  createReminder,
  listPendingReminders,
} from "@grimkeeper/database";

import { getReminderPingRoleId } from "../access.js";
import { logReminderAction } from "../action-log.js";
import { formatReminderDuration, parseReminderDuration, parseReminderHours } from "../reminder-duration.js";
import { discordTimestamp, formatReminderText, parseReminderEmoji } from "../reminder-message.js";
import {
  replyOrEditInteraction,
  requireReminderAccess,
} from "./command-context.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

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
    @SlashOption({
      name: "emoji",
      description: "Optional emoji prefix (e.g. 🔔 or a custom server emoji)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    emojiInput: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;

    const access = await requireReminderAccess(interaction);
    if (!access) return;
    if (!interaction.guildId) return;

    const { scope, game, engine, targetChannelId } = access;
    const minutes = parseReminderDuration(inDuration);
    if (!minutes) {
      await replyOrEditInteraction(interaction, {
        content: "Duration must be like `5m`, `10`, or `1h` (max 24h).",
        ...EPHEMERAL,
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
      await replyOrEditInteraction(interaction, {
        content: "Provide a `ping_role` or set `REMINDER_PING_ROLE_ID` for channel reminders.",
        ...EPHEMERAL,
      });
      return;
    }

    const emoji = parseReminderEmoji(emojiInput);
    if (emojiInput?.trim() && !emoji) {
      await replyOrEditInteraction(interaction, {
        content: "Emoji must be a single unicode emoji or custom emoji (e.g. `🔔` or `<:name:id>`).",
        ...EPHEMERAL,
      });
      return;
    }

    const pingNote = pingRoleId ? `, pinging <@&${pingRoleId}>` : "";
    const created = await createReminder({
      gameId: scope.kind === "game" ? scope.gameId : null,
      guildId: interaction.guildId,
      channelId: reminderChannelId,
      message: message.trim(),
      emoji,
      sourceKey: interaction.id,
      fireAt,
      createdBy: interaction.user.id,
      pingPlayers: Boolean(pingRoleId),
      pingRoleId: pingRoleId ?? null,
    });

    logReminderAction("created", {
      reminderId: created.id,
      scope: scope.kind,
      gameId: scope.kind === "game" ? scope.gameId : undefined,
      guildId: interaction.guildId,
      channelId: reminderChannelId,
      fireAt: fireAt.toISOString(),
      minutes,
      message: message.trim(),
      emoji: emoji ?? undefined,
      pingRoleId: pingRoleId ?? undefined,
      userId: interaction.user.id,
    });

    await replyOrEditInteraction(interaction, {
      content: `Reminder set in ${formatReminderDuration(minutes)} for ${where}${pingNote}: “${formatReminderText(message, emoji)}” (id: \`${created.id.slice(0, 8)}\`)`,
      ...EPHEMERAL,
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
      description: "Space-separated hours from now, decimals ok (e.g. 0.5 4 8 12)",
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
    @SlashOption({
      name: "emoji",
      description: "Optional emoji prefix (e.g. 🔔 or a custom server emoji)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    emojiInput: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;

    const access = await requireReminderAccess(interaction);
    if (!access) return;
    if (!interaction.guildId) return;

    const { scope, targetChannelId } = access;
    const hours = parseReminderHours(hoursInput);
    if (!hours) {
      await replyOrEditInteraction(interaction, {
        content:
          "Hours must be space-separated numbers from 0.5–24 (e.g. `0.5 4 8 12`), max 25 offsets.",
        ...EPHEMERAL,
      });
      return;
    }

    if (scope.kind === "channel") {
      const channelPingRoleId = pingRole?.id ?? getReminderPingRoleId();
      if (!channelPingRoleId) {
        await replyOrEditInteraction(interaction, {
          content: "Provide a `ping_role` or set `REMINDER_PING_ROLE_ID` for channel reminders.",
          ...EPHEMERAL,
        });
        return;
      }
    }

    const trimmedMessage = message.trim();
    const emoji = parseReminderEmoji(emojiInput);
    if (emojiInput?.trim() && !emoji) {
      await replyOrEditInteraction(interaction, {
        content: "Emoji must be a single unicode emoji or custom emoji (e.g. `🔔` or `<:name:id>`).",
        ...EPHEMERAL,
      });
      return;
    }

    const now = Date.now();
    const createdInThread = interaction.channel?.isThread() ?? false;
    const pingRoleId = pingRole?.id ?? (scope.kind === "channel" ? getReminderPingRoleId() : null);
    const seriesEndAt = new Date(now + Math.max(...hours) * 3_600_000);

    await Promise.all(
      hours.map((hour) =>
        createReminder({
          gameId: scope.kind === "game" ? scope.gameId : null,
          guildId: interaction.guildId!,
          channelId: targetChannelId,
          message: trimmedMessage,
          emoji,
          sourceKey: `${interaction.id}:${hour}`,
          fireAt: new Date(now + hour * 3_600_000),
          seriesEndAt,
          createdBy: interaction.user.id,
          pingPlayers: true,
          pingRoleId: pingRoleId ?? null,
        }),
      ),
    );

    const scheduleLines = hours.map((hour) => {
      const fireAt = new Date(now + hour * 3_600_000);
      return `- ${discordTimestamp(fireAt, "R")}`;
    });
    const totalPending = await countPendingReminders(scope);
    const scopeLabel = `<#${targetChannelId}>`;
    const threadNote = createdInThread ? " (created in thread, fires in parent channel)" : "";
    const pingLabel = pingRoleId ? `<@&${pingRoleId}>` : "player role";

    logReminderAction("created", {
      scope: scope.kind,
      gameId: scope.kind === "game" ? scope.gameId : undefined,
      guildId: interaction.guildId,
      channelId: targetChannelId,
      count: hours.length,
      hours,
      message: trimmedMessage,
      emoji: emoji ?? undefined,
      pingRoleId: pingRoleId ?? undefined,
      userId: interaction.user.id,
    });

    await replyOrEditInteraction(interaction, {
      content: [
        `Set **${hours.length}** reminder${hours.length === 1 ? "" : "s"} in <#${targetChannelId}> pinging ${pingLabel}${threadNote}:`,
        `“${formatReminderText(trimmedMessage, emoji)}”`,
        "",
        ...scheduleLines,
        "",
        `**${totalPending}** reminder${totalPending === 1 ? "" : "s"} pending for ${scopeLabel}. Run again anytime to add more.`,
      ].join("\n"),
      ...EPHEMERAL,
    });
  }

  @Slash({ name: "reminders", description: "List pending reminders for this game or channel" })
  async reminders(interaction: CommandInteraction): Promise<void> {
    const access = await requireReminderAccess(interaction);
    if (!access) return;

    const { scope } = access;
    const pending = await listPendingReminders(scope);
    logReminderAction("listed", {
      scope: scope.kind,
      gameId: scope.kind === "game" ? scope.gameId : undefined,
      count: pending.length,
      userId: interaction.user.id,
    });
    if (pending.length === 0) {
      await replyOrEditInteraction(interaction, { content: "No pending reminders.", ...EPHEMERAL });
      return;
    }

    const lines = pending.map((reminder) => {
      const when = discordTimestamp(reminder.fireAt, "R");
      const pingNote = reminder.pingPlayers
        ? reminder.pingRoleId
          ? ` (pings <@&${reminder.pingRoleId}>)`
          : " (pings players)"
        : "";
      return `- \`${reminder.id.slice(0, 8)}\` ${when} in <#${reminder.channelId}>${pingNote}: ${formatReminderText(reminder.message, reminder.emoji)}`;
    });

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Pending reminders")
          .setDescription(
            `${lines.join("\n")}\n\nDelete one with \`/st delete-reminder id:<prefix>\` or clear with \`/st clear-reminders\`.`,
          ),
      ],
      ...EPHEMERAL,
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
      await replyOrEditInteraction(interaction, {
        content: "Provide the `message` option when using scope `message`.",
        ...EPHEMERAL,
      });
      return;
    }

    if (scope === "channel" && !interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a channel or thread when scope is `channel`.",
        ...EPHEMERAL,
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
    logReminderAction("cancelled", {
      scope: reminderScope.kind,
      gameId: reminderScope.kind === "game" ? reminderScope.gameId : undefined,
      cancelled,
      remaining,
      filterScope: scope,
      userId: interaction.user.id,
    });
    await replyOrEditInteraction(interaction, {
      content:
        cancelled === 0
          ? "No matching pending reminders to cancel."
          : `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"}. **${remaining}** still pending.`,
      ...EPHEMERAL,
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
      await replyOrEditInteraction(interaction, {
        content: "Provide a reminder ID prefix.",
        ...EPHEMERAL,
      });
      return;
    }

    const cancelled = await cancelReminderByIdPrefix(reminderScope, trimmedId);
    if (cancelled === 0) {
      await replyOrEditInteraction(interaction, {
        content: `No pending reminder found with ID prefix \`${trimmedId}\`. Check \`/st reminders\`.`,
        ...EPHEMERAL,
      });
      return;
    }

    const remaining = await countPendingReminders(reminderScope);
    logReminderAction("cancelled", {
      scope: reminderScope.kind,
      gameId: reminderScope.kind === "game" ? reminderScope.gameId : undefined,
      cancelled,
      remaining,
      idPrefix: trimmedId,
      userId: interaction.user.id,
    });
    await replyOrEditInteraction(interaction, {
      content: `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"}. **${remaining}** still pending.`,
      ...EPHEMERAL,
    });
  }
}

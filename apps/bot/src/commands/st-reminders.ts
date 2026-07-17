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
  findRemindersByIdPrefix,
  listPendingReminders,
  updateReminder,
  batchReminderSourceKey,
} from "@grimkeeper/database";

import { getReminderPingRoleId } from "../access.js";
import { logReminderAction } from "../action-log.js";
import { formatReminderDuration, parseReminderDuration, parseReminderHours } from "../reminder-duration.js";
import {
  discordTimestamp,
  encodePingRoleIds,
  formatPingRoleMentions,
  formatReminderText,
  parseReminderEmoji,
  resolvePingRoleIds,
} from "../reminder-message.js";
import { postGameLog } from "../game-log-thread.js";
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

    if (game && interaction.guild) {
      await postGameLog(
        interaction.guild,
        game,
        `<@${interaction.user.id}> scheduled reminder in ${formatReminderDuration(minutes)} for ${where}: “${message.trim()}”`,
      );
    }

    await replyOrEditInteraction(interaction, {
      content: `Reminder set in ${formatReminderDuration(minutes)} for ${where}${pingNote}: “${formatReminderText(message, emoji)}” (id: \`${created.id.slice(0, 8)}\`)`,
      ...EPHEMERAL,
    });
  }

  @Slash({
    name: "set-reminders",
    description: "Replace channel hour-offset reminders (cancels previous set-reminders in this channel)",
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
      name: "ping_roles",
      description: "Roles to ping (@mentions or IDs). Defaults to REMINDER_PING_ROLE_ID or players.",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    pingRolesInput: string | undefined,
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

    const pingRoleIds = resolvePingRoleIds(
      pingRolesInput,
      scope.kind === "channel" ? getReminderPingRoleId() : null,
    );
    if (scope.kind === "channel" && pingRoleIds.length === 0) {
      await replyOrEditInteraction(interaction, {
        content:
          "Provide `ping_roles` or set `REMINDER_PING_ROLE_ID` for channel reminders.",
        ...EPHEMERAL,
      });
      return;
    }

    const trimmedMessage = message.trim();

    const now = Date.now();
    const createdInThread = interaction.channel?.isThread() ?? false;
    const pingRoleId = encodePingRoleIds(pingRoleIds);
    const seriesEndAt = new Date(now + Math.max(...hours) * 3_600_000);

    const replaced = await cancelReminders(scope, {
      channelId: targetChannelId,
      batchOnly: true,
    });

    await Promise.all(
      hours.map((hour) => {
        const fireAt = new Date(now + hour * 3_600_000);
        return createReminder({
          gameId: scope.kind === "game" ? scope.gameId : null,
          guildId: interaction.guildId!,
          channelId: targetChannelId,
          message: trimmedMessage,
          emoji: null,
          sourceKey: batchReminderSourceKey(
            interaction.guildId!,
            targetChannelId,
            fireAt,
            trimmedMessage,
          ),
          fireAt,
          seriesEndAt,
          createdBy: interaction.user.id,
          pingPlayers: true,
          pingRoleId: pingRoleId ?? null,
        });
      }),
    );

    const scheduleLines = hours.map((hour) => {
      const fireAt = new Date(now + hour * 3_600_000);
      return `- ${discordTimestamp(fireAt, "R")}`;
    });
    const totalPending = await countPendingReminders(scope);
    const scopeLabel = `<#${targetChannelId}>`;
    const threadNote = createdInThread ? " (created in thread, fires in parent channel)" : "";
    const pingLabel = formatPingRoleMentions(pingRoleId) ?? "player role";
    const replacedNote =
      replaced > 0
        ? ` Replaced **${replaced}** previous set-reminders ping${replaced === 1 ? "" : "s"} in this channel.`
        : "";

    logReminderAction("created", {
      scope: scope.kind,
      gameId: scope.kind === "game" ? scope.gameId : undefined,
      guildId: interaction.guildId,
      channelId: targetChannelId,
      count: hours.length,
      hours,
      replaced,
      message: trimmedMessage,
      pingRoleId: pingRoleId ?? undefined,
      userId: interaction.user.id,
    });

    if (access.game && interaction.guild) {
      const hourSummary = hours.map((hour) => `${hour}h`).join(", ");
      await postGameLog(
        interaction.guild,
        access.game,
        `<@${interaction.user.id}> set **${hours.length}** reminders (${hourSummary}) in <#${targetChannelId}>${replaced > 0 ? ` — replaced ${replaced} previous` : ""}: “${trimmedMessage}”`,
      );
    }

    await replyOrEditInteraction(interaction, {
      content: [
        `Set **${hours.length}** reminder${hours.length === 1 ? "" : "s"} in <#${targetChannelId}> pinging ${pingLabel}${threadNote}.${replacedNote}`,
        `“${trimmedMessage}”`,
        "",
        ...scheduleLines,
        "",
        `**${totalPending}** reminder${totalPending === 1 ? "" : "s"} pending for ${scopeLabel}. Run again to replace this channel’s set-reminders batch.`,
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
      const pingMentions = reminder.pingPlayers ? formatPingRoleMentions(reminder.pingRoleId) : null;
      const pingNote = reminder.pingPlayers
        ? pingMentions
          ? ` (pings ${pingMentions})`
          : " (pings players)"
        : "";
      return `- \`${reminder.id.slice(0, 8)}\` ${when} in <#${reminder.channelId}>${pingNote}: ${formatReminderText(reminder.message, reminder.emoji)}`;
    });

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Pending reminders")
          .setDescription(
            `${lines.join("\n")}\n\nEdit with \`/st edit-reminder id:<prefix>\`, delete with \`/st delete-reminder id:<prefix>\`, or clear with \`/st clear-reminders\`.`,
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

  @Slash({ name: "edit-reminder", description: "Update a pending reminder by ID prefix" })
  async editReminder(
    @SlashOption({
      name: "id",
      description: "ID prefix from /st reminders (e.g. first 8 characters)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    idPrefix: string,
    @SlashOption({
      name: "message",
      description: "New reminder text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | undefined,
    @SlashOption({
      name: "in",
      description: "Reschedule from now (e.g. 5m, 10, 1h)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    inDuration: string | undefined,
    @SlashOption({
      name: "ping_roles",
      description: "Roles to ping — @mentions or IDs, space/comma separated",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    pingRolesInput: string | undefined,
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

    const hasMessage = message !== undefined;
    const hasSchedule = inDuration !== undefined;
    const hasPingRoles = pingRolesInput !== undefined;
    if (!hasMessage && !hasSchedule && !hasPingRoles) {
      await replyOrEditInteraction(interaction, {
        content: "Provide at least one of `message`, `in`, or `ping_roles` to update.",
        ...EPHEMERAL,
      });
      return;
    }

    const matches = await findRemindersByIdPrefix(reminderScope, trimmedId);
    if (matches.length === 0) {
      await replyOrEditInteraction(interaction, {
        content: `No pending reminder found with ID prefix \`${trimmedId}\`. Check \`/st reminders\`.`,
        ...EPHEMERAL,
      });
      return;
    }
    if (matches.length > 1) {
      await replyOrEditInteraction(interaction, {
        content: `ID prefix \`${trimmedId}\` matches **${matches.length}** reminders. Use a longer prefix.`,
        ...EPHEMERAL,
      });
      return;
    }

    const reminder = matches[0];
    const updates: {
      message?: string;
      fireAt?: Date;
      pingPlayers?: boolean;
      pingRoleId?: string | null;
    } = {};
    const changes: string[] = [];

    if (hasMessage) {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        await replyOrEditInteraction(interaction, {
          content: "Message cannot be empty.",
          ...EPHEMERAL,
        });
        return;
      }
      updates.message = trimmedMessage;
      changes.push(`message → “${trimmedMessage}”`);
    }

    if (hasSchedule) {
      const minutes = parseReminderDuration(inDuration);
      if (!minutes) {
        await replyOrEditInteraction(interaction, {
          content: "Duration must be like `5m`, `10`, or `1h` (max 24h).",
          ...EPHEMERAL,
        });
        return;
      }
      const fireAt = new Date(Date.now() + minutes * 60_000);
      updates.fireAt = fireAt;
      changes.push(`fires ${discordTimestamp(fireAt, "R")}`);
    }

    if (hasPingRoles) {
      const pingRoleIds = resolvePingRoleIds(pingRolesInput, null);
      if (reminder.gameId === null && pingRoleIds.length === 0) {
        await replyOrEditInteraction(interaction, {
          content: "Channel reminders need at least one role in `ping_roles`.",
          ...EPHEMERAL,
        });
        return;
      }
      updates.pingRoleId = encodePingRoleIds(pingRoleIds);
      updates.pingPlayers = true;
      const pingLabel = formatPingRoleMentions(updates.pingRoleId) ?? "player role";
      changes.push(`pings ${pingLabel}`);
    }

    const updated = await updateReminder(reminder.id, updates);

    logReminderAction("updated", {
      reminderId: updated.id,
      scope: reminderScope.kind,
      gameId: reminderScope.kind === "game" ? reminderScope.gameId : undefined,
      changes,
      userId: interaction.user.id,
    });

    await replyOrEditInteraction(interaction, {
      content: [
        `Updated reminder \`${updated.id.slice(0, 8)}\` in <#${updated.channelId}>:`,
        ...changes.map((change) => `- ${change}`),
      ].join("\n"),
      ...EPHEMERAL,
    });
  }
}

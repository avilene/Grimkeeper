import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  Role,
  type CategoryChannel,
  type GuildBasedChannel,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  addGuildSettingRoleIds,
  ensureGuildSettings,
  getQueueBoardByGuild,
  parseIdList,
  resolveArchiveCategoryId,
  upsertGuildSettings,
} from "@grimkeeper/database";

import {
  canConfigureGuild,
  resolveGuildAccessConfig,
} from "../access.js";
import { replyOrEditInteraction } from "./command-context.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

type ClearField =
  | "allowed_roles"
  | "admin_roles"
  | "reminder_roles"
  | "ping_role"
  | "archive";

function formatRoleList(ids: Set<string> | Iterable<string>): string {
  const list = [...ids].filter(Boolean);
  if (list.length === 0) return "_(none — open / unset)_";
  return list.map((id) => `<@&${id}> (\`${id}\`)`).join("\n");
}

function formatSnowflake(id: string | null | undefined, kind: "role" | "category"): string {
  if (!id) return "_(not set)_";
  return kind === "role" ? `<@&${id}> (\`${id}\`)` : `<#${id}> (\`${id}\`)`;
}

function isCategoryChannel(channel: GuildBasedChannel | null): channel is CategoryChannel {
  return channel?.type === ChannelType.GuildCategory;
}

async function requireSetupAccess(interaction: CommandInteraction): Promise<boolean> {
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEditInteraction(interaction, {
      content: "Use `/setup` in a Discord server.",
      ...EPHEMERAL,
    });
    return false;
  }
  if (!(await canConfigureGuild(interaction))) {
    await replyOrEditInteraction(interaction, {
      content:
        "Only server managers (**Manage Server**), global `ADMIN_IDS`, or configured admin roles can run `/setup`.",
      ...EPHEMERAL,
    });
    return false;
  }
  return true;
}

async function buildSetupEmbed(guildId: string, guildName: string): Promise<EmbedBuilder> {
  const settings = await ensureGuildSettings(guildId);
  const effective = await resolveGuildAccessConfig(guildId);
  const archiveId = await resolveArchiveCategoryId(guildId);
  const queueBoard = await getQueueBoardByGuild(guildId);

  const allowedSource = effective.allowedRolesFromDb
    ? "this server (`/setup`)"
    : "env `ALLOWED_ROLE_IDS` (fallback)";
  const adminSource =
    settings.adminRoleIds != null ? "this server" : "env `ADMIN_ROLE_IDS` (fallback)";
  const reminderSource =
    settings.reminderRoleIds != null ? "this server" : "env `REMINDER_ROLE_IDS` (fallback)";
  const pingSource =
    settings.reminderPingRoleId != null
      ? "this server"
      : "env `REMINDER_PING_ROLE_ID` (fallback)";
  const archiveSource = settings.archiveCategoryId?.trim()
    ? "this server"
    : "env `ARCHIVE_CATEGORY_ID` (fallback)";

  return new EmbedBuilder()
    .setTitle(`Grimkeeper setup — ${guildName}`)
    .setDescription(
      [
        `Guild id: \`${guildId}\``,
        "",
        "Configure this server so role IDs from another guild’s env do not apply here.",
        "Next: `/st queue set` in a thread · `/game setup` to start a town.",
      ].join("\n"),
    )
    .addFields(
      {
        name: `Allowed roles (${allowedSource})`,
        value: formatRoleList(effective.allowedRoleIds),
      },
      {
        name: `Admin helper roles (${adminSource})`,
        value: formatRoleList(effective.adminRoleIds),
      },
      {
        name: `Reminder manager roles (${reminderSource})`,
        value: formatRoleList(effective.reminderRoleIds),
      },
      {
        name: `Reminder ping role (${pingSource})`,
        value: formatSnowflake(effective.reminderPingRoleId, "role"),
      },
      {
        name: `Archive category (${archiveSource})`,
        value: formatSnowflake(archiveId, "category"),
      },
      {
        name: "ST queue board",
        value: queueBoard?.threadId
          ? `<#${queueBoard.threadId}>`
          : "_(not set — run `/st queue set` in a thread)_",
      },
    )
    .setFooter({
      text: "/setup configure · /setup clear · Manage Server required",
    });
}

@Discord()
@SlashGroup({
  name: "setup",
  description: "Configure Grimkeeper for this Discord server",
})
@SlashGroup("setup")
export class SetupCommands {
  @Slash({
    name: "show",
    description: "Show this server’s Grimkeeper settings",
  })
  async show(interaction: CommandInteraction): Promise<void> {
    if (!(await requireSetupAccess(interaction))) return;
    const embed = await buildSetupEmbed(interaction.guildId!, interaction.guild!.name);
    await replyOrEditInteraction(interaction, {
      embeds: [embed],
      ...EPHEMERAL,
    });
  }

  @Slash({
    name: "configure",
    description: "Set roles / archive category for this server (adds to role lists)",
  })
  async configure(
    @SlashOption({
      name: "allowed_role",
      description: "Add a role that may use bot commands",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    allowedRole: Role | undefined,
    @SlashOption({
      name: "admin_role",
      description: "Add a helper role for private ST threads / pins",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    adminRole: Role | undefined,
    @SlashOption({
      name: "reminder_role",
      description: "Add a role that may manage channel reminders",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    reminderRole: Role | undefined,
    @SlashOption({
      name: "ping_role",
      description: "Default role pinged by channel reminders",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    pingRole: Role | undefined,
    @SlashOption({
      name: "archive_category",
      description: "Category for archived town channels",
      type: ApplicationCommandOptionType.Channel,
      required: false,
      channelTypes: [ChannelType.GuildCategory],
    })
    archiveCategory: GuildBasedChannel | undefined,
    @SlashOption({
      name: "open_commands",
      description: "Allow everyone to use bot commands in this server (clears allowed roles)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    openCommands: boolean | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireSetupAccess(interaction))) return;
    const guildId = interaction.guildId!;

    const changes: string[] = [];

    if (openCommands === true) {
      await upsertGuildSettings(guildId, { allowedRoleIds: "" });
      changes.push("Allowed roles → open to everyone in this server");
    } else if (allowedRole) {
      await addGuildSettingRoleIds(guildId, "allowedRoleIds", [allowedRole.id]);
      changes.push(`Allowed role + <@&${allowedRole.id}>`);
    }

    if (adminRole) {
      await addGuildSettingRoleIds(guildId, "adminRoleIds", [adminRole.id]);
      changes.push(`Admin helper role + <@&${adminRole.id}>`);
    }

    if (reminderRole) {
      await addGuildSettingRoleIds(guildId, "reminderRoleIds", [reminderRole.id]);
      changes.push(`Reminder manager role + <@&${reminderRole.id}>`);
    }

    if (pingRole) {
      await upsertGuildSettings(guildId, { reminderPingRoleId: pingRole.id });
      changes.push(`Reminder ping role → <@&${pingRole.id}>`);
    }

    if (archiveCategory) {
      if (!isCategoryChannel(archiveCategory)) {
        await replyOrEditInteraction(interaction, {
          content: "`archive_category` must be a category channel.",
          ...EPHEMERAL,
        });
        return;
      }
      await upsertGuildSettings(guildId, { archiveCategoryId: archiveCategory.id });
      changes.push(`Archive category → <#${archiveCategory.id}>`);
    }

    if (changes.length === 0) {
      await replyOrEditInteraction(interaction, {
        content:
          "Pass at least one option (`allowed_role`, `admin_role`, `reminder_role`, `ping_role`, `archive_category`, or `open_commands:true`). Or use `/setup show`.",
        ...EPHEMERAL,
      });
      return;
    }

    const embed = await buildSetupEmbed(guildId, interaction.guild!.name);
    await replyOrEditInteraction(interaction, {
      content: `Updated:\n• ${changes.join("\n• ")}`,
      embeds: [embed],
      ...EPHEMERAL,
    });
  }

  @Slash({
    name: "clear",
    description: "Clear one settings field (falls back to env, or unsets)",
  })
  async clear(
    @SlashChoice({ name: "Allowed roles (back to env)", value: "allowed_roles" })
    @SlashChoice({ name: "Admin helper roles (back to env)", value: "admin_roles" })
    @SlashChoice({ name: "Reminder manager roles (back to env)", value: "reminder_roles" })
    @SlashChoice({ name: "Reminder ping role (back to env)", value: "ping_role" })
    @SlashChoice({ name: "Archive category (back to env)", value: "archive" })
    @SlashOption({
      name: "field",
      description: "Which field to clear",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    field: ClearField,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireSetupAccess(interaction))) return;
    const guildId = interaction.guildId!;
    await ensureGuildSettings(guildId);

    switch (field) {
      case "allowed_roles":
        await upsertGuildSettings(guildId, { allowedRoleIds: null });
        break;
      case "admin_roles":
        await upsertGuildSettings(guildId, { adminRoleIds: null });
        break;
      case "reminder_roles":
        await upsertGuildSettings(guildId, { reminderRoleIds: null });
        break;
      case "ping_role":
        await upsertGuildSettings(guildId, { reminderPingRoleId: null });
        break;
      case "archive":
        await upsertGuildSettings(guildId, { archiveCategoryId: null });
        break;
      default: {
        const _exhaustive: never = field;
        await replyOrEditInteraction(interaction, {
          content: `Unknown field: ${String(_exhaustive)}`,
          ...EPHEMERAL,
        });
        return;
      }
    }

    const embed = await buildSetupEmbed(guildId, interaction.guild!.name);
    await replyOrEditInteraction(interaction, {
      content: `Cleared **${field}** for this server.`,
      embeds: [embed],
      ...EPHEMERAL,
    });
  }
}

/** Pure helper for tests — describe effective vs stored settings briefly. */
export function describeAllowedRolesSource(settings: {
  allowedRoleIds: string | null;
}): "db" | "env" {
  return settings.allowedRoleIds != null ? "db" : "env";
}

export function describeConfiguredRoleCount(csv: string | null | undefined): number {
  return parseIdList(csv).size;
}

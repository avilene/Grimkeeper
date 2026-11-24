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
  if (list.length === 0) return "_(none)_";
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
        "Only people with **Manage Server**, a bot admin account, or a helper role set in `/setup` can run this.",
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
    ? "set for this server"
    : "using shared bot defaults";
  const adminSource =
    settings.adminRoleIds != null ? "set for this server" : "using shared bot defaults";
  const reminderSource =
    settings.reminderRoleIds != null ? "set for this server" : "using shared bot defaults";
  const pingSource =
    settings.reminderPingRoleId != null ? "set for this server" : "using shared bot defaults";
  const archiveSource = settings.archiveCategoryId?.trim()
    ? "set for this server"
    : "using shared bot defaults";

  return new EmbedBuilder()
    .setTitle(`Grimkeeper setup — ${guildName}`)
    .setDescription(
      [
        `Server id: \`${guildId}\``,
        "",
        "Set roles here so this server does not reuse another server’s role list from the bot’s shared defaults.",
        "Next steps: `/st queue set` in a thread, then `/game setup` to start a town.",
      ].join("\n"),
    )
    .addFields(
      {
        name: `Who can use bot commands (${allowedSource})`,
        value: formatRoleList(effective.allowedRoleIds),
      },
      {
        name: `Helper roles for private ST threads (${adminSource})`,
        value: formatRoleList(effective.adminRoleIds),
      },
      {
        name: `Who can manage channel reminders (${reminderSource})`,
        value: formatRoleList(effective.reminderRoleIds),
      },
      {
        name: `Default reminder ping role (${pingSource})`,
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
      text: "Need Manage Server (or be a bot admin) · /setup configure · /setup clear",
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
    description: "Set roles and archive category for this server",
  })
  async configure(
    @SlashOption({
      name: "allowed_role",
      description: "Add a role that can use bot commands",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    allowedRole: Role | undefined,
    @SlashOption({
      name: "admin_role",
      description: "Add a helper role for private ST threads and pins",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    adminRole: Role | undefined,
    @SlashOption({
      name: "reminder_role",
      description: "Add a role that can manage channel reminders",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    reminderRole: Role | undefined,
    @SlashOption({
      name: "ping_role",
      description: "Role to ping by default for channel reminders",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    pingRole: Role | undefined,
    @SlashOption({
      name: "archive_category",
      description: "Category where archived town channels go",
      type: ApplicationCommandOptionType.Channel,
      required: false,
      channelTypes: [ChannelType.GuildCategory],
    })
    archiveCategory: GuildBasedChannel | undefined,
    @SlashOption({
      name: "open_commands",
      description: "Let everyone in this server use bot commands",
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
      changes.push("Bot commands are open to everyone in this server");
    } else if (allowedRole) {
      await addGuildSettingRoleIds(guildId, "allowedRoleIds", [allowedRole.id]);
      changes.push(`Added <@&${allowedRole.id}> as a command role`);
    }

    if (adminRole) {
      await addGuildSettingRoleIds(guildId, "adminRoleIds", [adminRole.id]);
      changes.push(`Added <@&${adminRole.id}> as a helper role`);
    }

    if (reminderRole) {
      await addGuildSettingRoleIds(guildId, "reminderRoleIds", [reminderRole.id]);
      changes.push(`Added <@&${reminderRole.id}> as a reminder manager role`);
    }

    if (pingRole) {
      await upsertGuildSettings(guildId, { reminderPingRoleId: pingRole.id });
      changes.push(`Reminder ping role is now <@&${pingRole.id}>`);
    }

    if (archiveCategory) {
      if (!isCategoryChannel(archiveCategory)) {
        await replyOrEditInteraction(interaction, {
          content: "Pick a category channel for `archive_category`.",
          ...EPHEMERAL,
        });
        return;
      }
      await upsertGuildSettings(guildId, { archiveCategoryId: archiveCategory.id });
      changes.push(`Archive category is now <#${archiveCategory.id}>`);
    }

    if (changes.length === 0) {
      await replyOrEditInteraction(interaction, {
        content:
          "Choose at least one option to change, or run `/setup show` to see the current settings.",
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
    description: "Clear one setting and go back to the shared bot defaults",
  })
  async clear(
    @SlashChoice({ name: "Who can use bot commands", value: "allowed_roles" })
    @SlashChoice({ name: "Helper roles for private ST threads", value: "admin_roles" })
    @SlashChoice({ name: "Who can manage channel reminders", value: "reminder_roles" })
    @SlashChoice({ name: "Default reminder ping role", value: "ping_role" })
    @SlashChoice({ name: "Archive category", value: "archive" })
    @SlashOption({
      name: "field",
      description: "Which setting to clear",
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

    const labels: Record<ClearField, string> = {
      allowed_roles: "who can use bot commands",
      admin_roles: "helper roles for private ST threads",
      reminder_roles: "who can manage channel reminders",
      ping_role: "the default reminder ping role",
      archive: "the archive category",
    };

    const embed = await buildSetupEmbed(guildId, interaction.guild!.name);
    await replyOrEditInteraction(interaction, {
      content: `Cleared ${labels[field]} for this server. It will use the shared bot defaults again.`,
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

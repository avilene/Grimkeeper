import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

import { canUseBot } from "../access.js";
import { reportError } from "../error-reporter.js";
import { isUnknownInteractionError } from "../interactions/interaction-response.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildHelpSearchEmbeds,
  buildStGuideEmbed,
  buildStHelpEmbeds,
  type HelpSearchScope,
  type StGuideTopic,
} from "./help-content.js";

const ACCESS_DENIED =
  "You are not allowed to use this bot. Ask an admin to add your user ID " +
  "to `ALLOWED_USER_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

/**
 * Prefers early public defer (see startEarlyDefer for help/guide), then editReply with embeds.
 * Avoids the ephemeral "Working…" path that can leave guides stuck.
 */
async function replyHelpEmbeds(
  interaction: CommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const allowed = await canUseBot(interaction);
    if (!allowed) {
      await interaction.editReply({ content: ACCESS_DENIED, embeds: [] });
      return;
    }

    await interaction.editReply({ content: null, embeds });
  } catch (error) {
    // Token already dead — early ack missed Discord's window or another replica handled it.
    if (isUnknownInteractionError(error)) {
      void reportError("help.reply.expired", error, {
        command: interaction.commandName,
        subcommandGroup: interaction.isChatInputCommand()
          ? interaction.options.getSubcommandGroup(false) ?? undefined
          : undefined,
        subcommand: interaction.isChatInputCommand()
          ? interaction.options.getSubcommand(false) ?? undefined
          : undefined,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        deferred: interaction.deferred,
        replied: interaction.replied,
        ageMs: Date.now() - interaction.createdTimestamp,
      });
      return;
    }

    void reportError("help.reply.failed", error, {
      command: interaction.commandName,
      subcommandGroup: interaction.isChatInputCommand()
        ? interaction.options.getSubcommandGroup(false) ?? undefined
        : undefined,
      subcommand: interaction.isChatInputCommand()
        ? interaction.options.getSubcommand(false) ?? undefined
        : undefined,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      deferred: interaction.deferred,
      replied: interaction.replied,
    });

    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({ content: "Could not show that guide. Try again.", embeds: [] })
        .catch(() => undefined);
      return;
    }
    await interaction
      .reply({ content: "Could not show that guide. Try again.", flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }
}

async function replyScopedHelp(
  interaction: CommandInteraction,
  scope: HelpSearchScope,
  search: string | undefined,
  full: () => EmbedBuilder[],
): Promise<void> {
  const query = search?.trim();
  await replyHelpEmbeds(
    interaction,
    query ? buildHelpSearchEmbeds(scope, query) : full(),
  );
}

async function replyStGuide(
  interaction: CommandInteraction,
  topic: StGuideTopic,
): Promise<void> {
  await replyHelpEmbeds(interaction, [buildStGuideEmbed(topic)]);
}

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameHelpCommands {
  @Slash({ name: "help", description: "Show player command guide (optional search)" })
  async help(
    @SlashOption({
      name: "search",
      description: "Filter commands by name or description",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    search: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await replyScopedHelp(interaction, "game", search, buildGameHelpEmbeds);
  }
}

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StHelpCommands {
  @Slash({ name: "help", description: "Show storyteller command guide (optional search)" })
  async help(
    @SlashOption({
      name: "search",
      description: "Filter commands by name or description",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    search: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await replyScopedHelp(interaction, "st", search, buildStHelpEmbeds);
  }
}

/**
 * Nested `/st guide setup|day|night`.
 * Note: `guide` must be a subcommand group only — Discord cannot also have `/st guide` as a plain subcommand.
 */
@Discord()
@SlashGroup({
  name: "guide",
  description: "Phase checklists for storytellers",
  root: "st",
})
@SlashGroup("guide", "st")
export class StGuideCommands {
  @Slash({ name: "setup", description: "Checklist: lobby → town setup" })
  async setup(interaction: CommandInteraction): Promise<void> {
    await replyStGuide(interaction, "setup");
  }

  @Slash({ name: "day", description: "Checklist: running a day" })
  async day(interaction: CommandInteraction): Promise<void> {
    await replyStGuide(interaction, "day");
  }

  @Slash({ name: "night", description: "Checklist: running a night" })
  async night(interaction: CommandInteraction): Promise<void> {
    await replyStGuide(interaction, "night");
  }
}

@Discord()
@SlashGroup({ name: "dev", description: "Development utilities (DEV_MODE only)" })
@SlashGroup("dev")
export class DevHelpCommands {
  @Slash({ name: "help", description: "Show /dev testing commands (optional search)" })
  async help(
    @SlashOption({
      name: "search",
      description: "Filter commands by name or description",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    search: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await replyScopedHelp(interaction, "dev", search, buildDevHelpEmbeds);
  }
}

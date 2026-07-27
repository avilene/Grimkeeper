import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

import { canUseBot } from "../access.js";
import { reportError } from "../error-reporter.js";
import {
  isRecoverableInteractionResponseError,
  isUnknownInteractionError,
  shouldReportUnknownInteractionAck,
} from "../interactions/interaction-response.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildHelpSearchEmbeds,
  buildPlayerHelpEmbeds,
  buildStGuideEmbed,
  buildStHelpEmbeds,
  type HelpSearchScope,
  type StGuideTopic,
} from "./help-content.js";
import {
  buildHelpPageMessage,
  shouldPaginateHelp,
} from "./help-pagination.js";

const ACCESS_DENIED =
  "You are not allowed to use this bot. Ask an admin to add your user ID " +
  "to `ADMIN_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

function helpReplyContext(interaction: CommandInteraction) {
  return {
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
  };
}

/**
 * Idempotent public defer for help/guide. Early defer usually already ran;
 * if Discord says already-acked (40060), continue to editReply.
 * Unknown interaction (10062) means the token is dead — rethrow.
 */
async function ensureHelpDeferred(interaction: CommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply();
  } catch (error) {
    if (isUnknownInteractionError(error)) throw error;
    if (isRecoverableInteractionResponseError(error)) return;
    throw error;
  }
}

/**
 * Prefers early public defer (see startEarlyDefer for help/guide), then editReply with embeds.
 * Avoids the ephemeral "Working…" path that can leave guides stuck.
 * Oversized multi-embed guides are paginated (Discord's combined embed limit is 6000).
 */
async function replyHelpEmbeds(
  interaction: CommandInteraction,
  embeds: EmbedBuilder[],
  options?: { requireAccess?: boolean; pageScope?: HelpSearchScope },
): Promise<void> {
  const requireAccess = options?.requireAccess !== false;
  try {
    await ensureHelpDeferred(interaction);

    if (requireAccess) {
      const allowed = await canUseBot(interaction);
      if (!allowed) {
        await interaction.editReply({ content: ACCESS_DENIED, embeds: [], components: [] });
        return;
      }
    }

    if (options?.pageScope && shouldPaginateHelp(embeds)) {
      const page = buildHelpPageMessage(options.pageScope, 0);
      await interaction.editReply({
        content: null,
        embeds: page.embeds,
        components: page.components,
      });
      return;
    }

    await interaction.editReply({ content: null, embeds, components: [] });
  } catch (error) {
    // Token dead / already handled elsewhere (early ack miss, duplicate replica, etc.).
    // Includes 40060 — local deferred/replied flags stay false after a failed defer race.
    if (isRecoverableInteractionResponseError(error)) {
      const context = helpReplyContext(interaction);
      if (!shouldReportUnknownInteractionAck(context.ageMs)) return;
      void reportError(
        isUnknownInteractionError(error) ? "help.reply.expired" : "help.reply.skipped",
        error,
        context,
      );
      return;
    }

    void reportError("help.reply.failed", error, helpReplyContext(interaction));

    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({ content: "Could not show that guide. Try again.", embeds: [], components: [] })
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
  options?: { requireAccess?: boolean },
): Promise<void> {
  const query = search?.trim();
  await replyHelpEmbeds(
    interaction,
    query ? buildHelpSearchEmbeds(scope, query) : full(),
    {
      ...options,
      pageScope: query ? undefined : scope,
    },
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
@SlashGroup({ name: "player", description: "Day-play commands for players in an active game" })
@SlashGroup("player")
export class PlayerHelpCommands {
  @Slash({
    name: "help",
    description: "Show nominate / vote / whisper / alias guide (optional search)",
  })
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
    await replyScopedHelp(interaction, "player", search, buildPlayerHelpEmbeds, {
      requireAccess: false,
    });
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

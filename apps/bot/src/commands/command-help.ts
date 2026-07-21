import { ApplicationCommandOptionType, CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

import { replyOrEditInteraction, requireCommandAccess } from "./command-context.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildHelpSearchEmbeds,
  buildStGuideEmbed,
  buildStHelpEmbeds,
  type HelpSearchScope,
  type StGuideTopic,
} from "./help-content.js";

async function replyWithHelp(
  interaction: CommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  await replyOrEditInteraction(interaction, { embeds });
}

async function replyScopedHelp(
  interaction: CommandInteraction,
  scope: HelpSearchScope,
  search: string | undefined,
  full: () => EmbedBuilder[],
): Promise<void> {
  if (!(await requireCommandAccess(interaction))) return;
  const query = search?.trim();
  await replyWithHelp(
    interaction,
    query ? buildHelpSearchEmbeds(scope, query) : full(),
  );
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

async function replyStGuide(
  interaction: CommandInteraction,
  topic: StGuideTopic,
): Promise<void> {
  if (!(await requireCommandAccess(interaction))) return;
  await replyWithHelp(interaction, [buildStGuideEmbed(topic)]);
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

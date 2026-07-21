import { ApplicationCommandOptionType, CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";

import { requireCommandAccess } from "./command-context.js";
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
  // Help/guide are fast — reply once with the embeds (avoid "Working…" then edit).
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: null, embeds }).catch(async () => {
      await interaction.followUp({ embeds }).catch(() => undefined);
    });
    return;
  }
  await interaction.reply({ embeds });
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

  @Slash({
    name: "guide",
    description: "Phase checklist: setup, day, or night",
  })
  async guide(
    @SlashChoice({ name: "Setup", value: "setup" })
    @SlashChoice({ name: "Day", value: "day" })
    @SlashChoice({ name: "Night", value: "night" })
    @SlashOption({
      name: "phase",
      description: "Which checklist to show",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    phase: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const topic = parseGuidePhase(phase);
    if (!topic) {
      if (!(await requireCommandAccess(interaction))) return;
      await replyWithHelp(interaction, [
        new EmbedBuilder()
          .setTitle("Unknown guide phase")
          .setDescription("Pick **setup**, **day**, or **night**."),
      ]);
      return;
    }
    await replyStGuide(interaction, topic);
  }
}

function parseGuidePhase(value: string): StGuideTopic | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "setup" || normalized === "day" || normalized === "night") {
    return normalized;
  }
  return null;
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

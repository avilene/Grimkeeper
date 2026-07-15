import { CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashGroup } from "discordx";

import { replyOrEditInteraction, requireCommandAccess } from "./command-context.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildStHelpEmbeds,
} from "./help-content.js";

async function replyWithHelp(
  interaction: CommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  await replyOrEditInteraction(interaction, { embeds });
}

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameHelpCommands {
  @Slash({ name: "help", description: "Show /game commands and how town voting works" })
  async help(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await replyWithHelp(interaction, buildGameHelpEmbeds());
  }

  @Slash({ name: "commands", description: "Show /game commands and how town voting works" })
  async commands(interaction: CommandInteraction): Promise<void> {
    await this.help(interaction);
  }
}

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StHelpCommands {
  @Slash({ name: "help", description: "Show storyteller setup and command guide" })
  async help(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await replyWithHelp(interaction, buildStHelpEmbeds());
  }

  @Slash({ name: "commands", description: "Show storyteller setup and command guide" })
  async commands(interaction: CommandInteraction): Promise<void> {
    await this.help(interaction);
  }
}

@Discord()
@SlashGroup({ name: "dev", description: "Development utilities (DEV_MODE only)" })
@SlashGroup("dev")
export class DevHelpCommands {
  @Slash({ name: "help", description: "Show /dev testing commands" })
  async help(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await replyWithHelp(interaction, buildDevHelpEmbeds());
  }

  @Slash({ name: "commands", description: "Show /dev testing commands" })
  async commands(interaction: CommandInteraction): Promise<void> {
    await this.help(interaction);
  }
}

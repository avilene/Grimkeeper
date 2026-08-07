import { CommandInteraction, MessageFlags } from "discord.js";
import { Discord, Slash } from "discordx";
import {
  defaultBuffetConfig,
  formatBuffetRulesMessage,
  type BuffetDraftConfig,
} from "@grimkeeper/engine";

import {
  loadEngine,
  replyOrEditInteraction,
  requireDayPlayAccess,
  resolveActiveGameForInteraction,
} from "./command-context.js";

function resolveBuffetConfig(
  buffetConfig: unknown,
  engineConfig: BuffetDraftConfig | undefined,
): BuffetDraftConfig {
  if (engineConfig) return engineConfig;
  if (buffetConfig && typeof buffetConfig === "object") {
    return buffetConfig as BuffetDraftConfig;
  }
  return defaultBuffetConfig();
}

@Discord()
export class ScriptCommands {
  @Slash({
    name: "script",
    description: "Show the Sushi Buffet script and house rules for this game",
  })
  async script(interaction: CommandInteraction): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Use `/script` in a server with an active game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      await replyOrEditInteraction(interaction, {
        content: "No active game in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (game.setupMode !== "buffet" && !game.buffetConfig) {
      await replyOrEditInteraction(interaction, {
        content: "This game is not using Sushi Buffet. Ask your Storyteller for the script.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const config = resolveBuffetConfig(game.buffetConfig, engine.getState().buffetDraft?.config);

    await replyOrEditInteraction(interaction, {
      content: formatBuffetRulesMessage(config),
    });
  }
}

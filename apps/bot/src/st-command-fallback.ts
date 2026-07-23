import type { ChatInputCommandInteraction } from "discord.js";

import { replyOrEditInteraction } from "./commands/command-context.js";
import { StCommandsMinimal } from "./commands/st-minimal.js";
import { log } from "./logger.js";

/**
 * discordx can log "interaction not found" for a valid `/st …` leaf (deploy skew,
 * tree mismatch). Fall back to direct handlers so early-defer "Working…" does not hang.
 */
export async function tryStCommandFallback(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== "st") return false;
  if (interaction.options.getSubcommandGroup(false)) return false;

  const sub = interaction.options.getSubcommand(false);
  if (!sub) return false;

  const st = new StCommandsMinimal();

  switch (sub) {
    case "recreate-player-thread": {
      const player = interaction.options.getUser("player");
      if (!player) {
        await replyOrEditInteraction(interaction, {
          content: "`player:` is required for `/st recreate-player-thread`.",
        });
        return true;
      }
      log("info", "st.fallback.dispatch", { sub, playerId: player.id });
      await st.recreatePlayerThread(player, interaction);
      return true;
    }
    default:
      return false;
  }
}

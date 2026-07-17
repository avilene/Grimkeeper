import { MessageFlags, type ButtonInteraction } from "discord.js";
import { getActiveGameForGuild } from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import {
  loadEngine,
  persistEvents,
  replyEngineError,
} from "../commands/command-context.js";
import {
  parseLockVotesButtonCustomId,
  upsertStVoteTracker,
} from "../st-vote-tracker.js";
import { refreshNominationEverywhere } from "../commands/command-context.js";
import { isRecoverableInteractionResponseError } from "./interaction-response.js";

export async function handleLockVotesButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseLockVotesButtonCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }

  if (!interaction.guildId || !interaction.guild) {
    await interaction.editReply({ content: "This must be used in a server." }).catch(() => undefined);
    return true;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game || game.id !== parsed.gameId) {
    await interaction.editReply({ content: "No matching active game." }).catch(() => undefined);
    return true;
  }

  try {
    const engine = await loadEngine(game.id);
    if (!engine.isStoryteller(interaction.user.id)) {
      await interaction.editReply({ content: "Only storytellers can lock or unlock votes." });
      return true;
    }

    const events = engine.handle({
      kind: parsed.lock
        ? GameCommandKind.LockNominationVotes
        : GameCommandKind.UnlockNominationVotes,
      gameId: game.id,
      nominationId: parsed.nominationId,
    });
    await persistEvents(engine, events);

    await upsertStVoteTracker(interaction.guild, game.channelId, engine, game.kibThreadId);
    await refreshNominationEverywhere(interaction.guild, game, engine, parsed.nominationId);

    const nomination = engine.getNominationById(parsed.nominationId);
    await interaction.editReply({
      content: parsed.lock
        ? `Votes locked on nomination #${nomination?.order ?? "?"}. Players can no longer change votes.`
        : `Votes unlocked on nomination #${nomination?.order ?? "?"}.`,
    });
  } catch (error) {
    try {
      await replyEngineError(interaction, error);
    } catch (replyError) {
      if (!isRecoverableInteractionResponseError(replyError)) throw replyError;
    }
  }

  return true;
}

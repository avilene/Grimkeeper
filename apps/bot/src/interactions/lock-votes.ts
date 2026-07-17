import { MessageFlags, type ButtonInteraction } from "discord.js";
import { getGameById } from "@grimkeeper/database";
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
import {
  INTERACTION_PENDING_CONTENT,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";

export async function handleLockVotesButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseLockVotesButtonCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.deferred && !interaction.replied) {
    await interaction
      .reply({ content: INTERACTION_PENDING_CONTENT, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }

  if (!interaction.guildId || !interaction.guild) {
    await interaction.editReply({ content: "This must be used in a server." }).catch(() => undefined);
    return true;
  }

  const game = await getGameById(parsed.gameId);
  if (!game || game.guildId !== interaction.guildId) {
    await interaction
      .editReply({ content: "No matching game for this nomination (it may be from an older game)." })
      .catch(() => undefined);
    return true;
  }
  if (game.phase === "ended") {
    await interaction.editReply({ content: "That game has ended." }).catch(() => undefined);
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

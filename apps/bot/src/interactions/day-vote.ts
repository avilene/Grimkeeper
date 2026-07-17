import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { getActiveGameForGuild } from "@grimkeeper/database";
import { GameCommandKind, type VoteChoice } from "@grimkeeper/engine";

import { canUseMinimalVoting } from "../access.js";
import { isMinimalMode } from "../bot-mode.js";
import {
  parseVoteButtonCustomId,
  parseVoteModalCustomId,
  voteModalCustomId,
} from "../day-thread.js";
import {
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  replyEngineError,
  resolveVotingChannel,
  syncGameProjection,
} from "../commands/command-context.js";
import { isRecoverableInteractionResponseError } from "./interaction-response.js";

const VOTE_CHOICE_FIELD = "choice";
const VOTE_REASON_FIELD = "reason";

function parseVoteChoice(value: string): VoteChoice | null {
  if (value === "yes" || value === "no" || value === "conditional") return value;
  return null;
}

export async function handleVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseVoteButtonCustomId(interaction.customId);
  if (!parsed) return false;

  // Show the modal as soon as possible — Discord's 3s window closes before DB work.
  if (!interaction.guildId) {
    await interaction.reply({ content: "This must be used in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game || game.id !== parsed.gameId) {
      await interaction.reply({ content: "No matching active game.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const engine = await loadEngine(game.id);
    const nomination = engine.getNominationById(parsed.nominationId);
    if (!nomination || nomination.status !== "open") {
      await interaction.reply({
        content: "That nomination is not open for voting.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const voter = engine.getPlayerByDiscordId(interaction.user.id);
    if (!voter) {
      await interaction.reply({ content: "You are not in this game.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (isMinimalMode() && !canUseMinimalVoting(interaction.user.id)) {
      await interaction.reply({
        content:
          "Voting is restricted to allowlisted users (`ALLOWED_USER_IDS`) during development.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const nominee = engine.getPlayerById(nomination.nomineeId);
    const contextLines = [
      `Accusation: ${nomination.accusation}`,
      `Defense: ${nomination.defense ?? "—"}`,
    ].join("\n");

    const modal = new ModalBuilder()
      .setCustomId(voteModalCustomId(game.id, nomination.id))
      .setTitle(`Vote: ${nominee?.displayName ?? "nominee"}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(VOTE_CHOICE_FIELD)
            .setLabel("Vote (yes / no / conditional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
            .setPlaceholder("yes, no, or conditional"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(VOTE_REASON_FIELD)
            .setLabel("Reason (required if conditional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
            .setPlaceholder(contextLines.slice(0, 100)),
        ),
      );

    await interaction.showModal(modal);
  } catch (error) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "Could not open the vote form. Try again in a moment.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
    }
    if (!isRecoverableInteractionResponseError(error)) {
      throw error;
    }
  }

  return true;
}

export async function handleVoteModalSubmit(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseVoteModalCustomId(interaction.customId);
  if (!parsed) return false;

  // Ack immediately so Discord does not expire the interaction while we persist.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }

  if (!interaction.guildId) {
    await interaction.editReply({ content: "This must be used in a server." }).catch(() => undefined);
    return true;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game || game.id !== parsed.gameId) {
    await interaction.editReply({ content: "No matching active game." }).catch(() => undefined);
    return true;
  }

  const engine = await loadEngine(game.id);
  const voter = engine.getPlayerByDiscordId(interaction.user.id);
  if (!voter) {
    await interaction.editReply({ content: "You are not in this game." }).catch(() => undefined);
    return true;
  }

  if (isMinimalMode() && !canUseMinimalVoting(interaction.user.id)) {
    await interaction
      .editReply({
        content:
          "Voting is restricted to allowlisted users (`ALLOWED_USER_IDS`) during development.",
      })
      .catch(() => undefined);
    return true;
  }

  const choiceRaw = interaction.fields.getTextInputValue(VOTE_CHOICE_FIELD).trim().toLowerCase();
  const choice = parseVoteChoice(choiceRaw);
  if (!choice) {
    await interaction.editReply({ content: "Invalid vote choice. Use yes, no, or conditional." }).catch(() => undefined);
    return true;
  }

  const reason = interaction.fields.getTextInputValue(VOTE_REASON_FIELD).trim() || null;

  try {
    const events = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId: game.id,
      voterId: voter.id,
      nominationId: parsed.nominationId,
      choice,
      reason,
    });
    await persistEvents(engine, events);
    await syncGameProjection(game.id, engine);

    const day = engine.getState().day;
    const isSecret = day?.voteVisibility === "secret";
    const isSt = engine.isStoryteller(interaction.user.id);
    const nomination = engine.getNominationById(parsed.nominationId);
    const fromPrivateThread =
      interaction.channel?.isThread() &&
      interaction.channelId !== day?.discordThreadId &&
      interaction.channelId !== game.channelId;

    if (interaction.guild) {
      await refreshNominationEverywhere(interaction.guild, game, engine, parsed.nominationId, {
        revealSecret: false,
      });

      // Public result announcement only for public votes cast in the shared vote venue.
      if (!isSecret && !fromPrivateThread) {
        const voting = await resolveVotingChannel(interaction.guild, game, engine);
        const openCount =
          engine.getState().day?.nominations.filter((candidate) => candidate.status === "open")
            .length ?? 0;
        const tally = nomination
          ? engine.formatNominationTally(nomination.id, { revealSecret: true })
          : "";
        const nominee = nomination ? engine.getPlayerById(nomination.nomineeId) : null;
        await voting
          ?.send({
            content: `<@${interaction.user.id}> voted **${choice}** on **${nominee?.displayName ?? "nominee"}**. ${tally}${openCount > 1 ? `\n_${openCount} nominations still open._` : ""}`,
            allowedMentions: { users: [] },
          })
          .catch(() => undefined);
      }
    }

    if (isSecret && !isSt) {
      await interaction.editReply({ content: "Vote recorded privately." });
      return true;
    }

    const tally = nomination
      ? engine.formatNominationTally(nomination.id, { revealSecret: true })
      : "";
    await interaction.editReply({
      content: fromPrivateThread
        ? `Private vote recorded (${choice}). ${tally}`
        : `Vote recorded (${choice}). ${tally}`,
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }

  return true;
}

export async function castVoteFromSlash(
  gameId: string,
  voterId: string,
  nominationId: string,
  choice: VoteChoice,
  reason: string | null,
): Promise<{ engine: Awaited<ReturnType<typeof loadEngine>>; events: ReturnType<
  Awaited<ReturnType<typeof loadEngine>>["handle"]
> }> {
  const engine = await loadEngine(gameId);
  const events = engine.handle({
    kind: GameCommandKind.CastVote,
    gameId,
    voterId,
    nominationId,
    choice,
    reason,
  });
  return { engine, events };
}

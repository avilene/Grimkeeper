import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { getActiveGameForChannel, getGameById, listActiveGamesForGuild } from "@grimkeeper/database";
import { GameCommandKind, type VoteChoice } from "@grimkeeper/engine";

import {
  parseVoteButtonCustomId,
  parseVoteModalCustomId,
  voteModalCustomId,
  VOTE_BUTTON_PREFIX,
  VOTE_MODAL_PREFIX,
} from "../day-thread.js";
import {
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  replyEngineError,
  resolveVotingChannel,
  syncGameProjection,
} from "../commands/command-context.js";
import { log } from "../logger.js";
import {
  INTERACTION_PENDING_CONTENT,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";

const VOTE_CHOICE_FIELD = "choice";
const VOTE_REASON_FIELD = "reason";

function parseVoteChoice(value: string): VoteChoice | null {
  if (value === "yes" || value === "no" || value === "conditional") return value;
  return null;
}

async function resolveGameForVoteIds(
  guildId: string,
  gameId: string,
  nominationId: string,
  channelId?: string | null,
): Promise<NonNullable<Awaited<ReturnType<typeof getGameById>>> | null> {
  const byId = await getGameById(gameId);
  if (byId && byId.guildId === guildId && byId.phase !== "ended") {
    return byId;
  }

  // Prefer the game for this channel when the button id was mangled.
  if (channelId) {
    const parentId = channelId;
    const forChannel = await getActiveGameForChannel(guildId, parentId);
    if (forChannel) {
      const engine = await loadEngine(forChannel.id);
      if (engine.getNominationById(nominationId)) return forChannel;
    }
  }

  // Last resort: any active guild game that still has this nomination.
  for (const active of await listActiveGamesForGuild(guildId)) {
    const engine = await loadEngine(active.id);
    if (engine.getNominationById(nominationId)) return active;
  }
  return null;
}

export async function handleVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  // `gk:vote-modal:` also starts with `gk:vote:` — only real vote buttons belong here.
  if (
    !interaction.customId.startsWith(VOTE_BUTTON_PREFIX) ||
    interaction.customId.startsWith(VOTE_MODAL_PREFIX)
  ) {
    return false;
  }

  const parsed = parseVoteButtonCustomId(interaction.customId);
  if (!parsed) {
    await interaction
      .reply({
        content: "That Vote button is invalid or too old. Use a nomination in **Town Voting**, or `/vote` in your ST thread.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
    return true;
  }

  // showModal must be the first response — keep this path free of DB/network work.
  if (!interaction.guildId) {
    await interaction.reply({ content: "This must be used in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    const modal = new ModalBuilder()
      .setCustomId(voteModalCustomId(parsed.gameId, parsed.nominationId))
      .setTitle("Cast your vote")
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
            .setPlaceholder("Optional unless voting conditional"),
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
  if (!interaction.customId.startsWith(VOTE_MODAL_PREFIX)) return false;

  const parsed = parseVoteModalCustomId(interaction.customId);

  // Ack immediately so Discord does not expire the interaction while we persist.
  if (!interaction.deferred && !interaction.replied) {
    await interaction
      .reply({ content: INTERACTION_PENDING_CONTENT, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }

  if (!parsed) {
    await interaction
      .editReply({
        content:
          "That vote form is invalid or too old. Press **Vote** again in Town Voting, or use `/vote`.",
      })
      .catch(() => undefined);
    return true;
  }

  if (!interaction.guildId) {
    await interaction.editReply({ content: "This must be used in a server." }).catch(() => undefined);
    return true;
  }

  const parentChannelId = interaction.channel?.isThread()
    ? interaction.channel.parentId
    : interaction.channelId;

  const game = await resolveGameForVoteIds(
    interaction.guildId,
    parsed.gameId,
    parsed.nominationId,
    parentChannelId,
  );
  if (!game) {
    log("warn", "vote.game_lookup_failed", {
      guildId: interaction.guildId,
      parsedGameId: parsed.gameId,
      nominationId: parsed.nominationId,
      userId: interaction.user.id,
      customId: interaction.customId,
    });
    await interaction
      .editReply({
        content:
          "Could not find the active game for this vote. Open **Town Voting** and press Vote on the nomination there, or use `/vote` in your ST thread.",
      })
      .catch(() => undefined);
    return true;
  }

  const engine = await loadEngine(game.id);
  const voter = engine.getPlayerByDiscordId(interaction.user.id);
  if (!voter) {
    await interaction.editReply({ content: "You are not in this game." }).catch(() => undefined);
    return true;
  }

  const nomination = engine.getNominationById(parsed.nominationId);
  if (!nomination || nomination.status !== "open") {
    await interaction
      .editReply({ content: "That nomination is not open for voting." })
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

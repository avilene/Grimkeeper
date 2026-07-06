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

import {
  parseVoteButtonCustomId,
  parseVoteModalCustomId,
  updateNominationMessage,
  voteModalCustomId,
  type DayDiscussionChannel,
} from "../day-thread.js";
import {
  loadEngine,
  persistEvents,
  replyEngineError,
  syncGameProjection,
} from "../commands/command-context.js";

const VOTE_CHOICE_FIELD = "choice";
const VOTE_REASON_FIELD = "reason";

function parseVoteChoice(value: string): VoteChoice | null {
  if (value === "yes" || value === "no" || value === "conditional") return value;
  return null;
}

export async function handleVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseVoteButtonCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.guildId) {
    await interaction.reply({ content: "This must be used in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game || game.id !== parsed.gameId) {
    await interaction.reply({ content: "No matching active game.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const engine = await loadEngine(game.id);
  const nomination = engine.getNominationById(parsed.nominationId);
  if (!nomination) {
    await interaction.reply({ content: "That nomination no longer exists.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const voter = engine.getPlayerByDiscordId(interaction.user.id);
  if (!voter) {
    await interaction.reply({ content: "You are not in this game.", flags: MessageFlags.Ephemeral });
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
  return true;
}

export async function handleVoteModalSubmit(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseVoteModalCustomId(interaction.customId);
  if (!parsed) return false;

  if (!interaction.guildId) {
    await interaction.reply({ content: "This must be used in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game || game.id !== parsed.gameId) {
    await interaction.reply({ content: "No matching active game.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const engine = await loadEngine(game.id);
  const voter = engine.getPlayerByDiscordId(interaction.user.id);
  if (!voter) {
    await interaction.reply({ content: "You are not in this game.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const choiceRaw = interaction.fields.getTextInputValue(VOTE_CHOICE_FIELD).trim().toLowerCase();
  const choice = parseVoteChoice(choiceRaw);
  if (!choice) {
    await interaction.reply({ content: "Invalid vote choice.", flags: MessageFlags.Ephemeral });
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

    if (interaction.channel?.isTextBased() && !interaction.channel.isDMBased()) {
      await updateNominationMessage(
        engine,
        game.id,
        interaction.channel as DayDiscussionChannel,
        parsed.nominationId,
        { revealSecret: isSt },
      );
    }

    const nomination = engine.getNominationById(parsed.nominationId);
    if (isSecret && !isSt) {
      await interaction.reply({
        content: "Vote recorded.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const tally = nomination
      ? engine.formatNominationTally(nomination.id, { revealSecret: true })
      : "";
    await interaction.reply({
      content: `Vote recorded (${choice}). ${tally}`,
      flags: isSecret ? MessageFlags.Ephemeral : undefined,
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

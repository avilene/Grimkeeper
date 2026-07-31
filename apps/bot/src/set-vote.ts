import { MessageFlags, type CommandInteraction, type Guild } from "discord.js";
import { prisma } from "@grimkeeper/database";
import { GameCommandKind, type VoteChoice } from "@grimkeeper/engine";

import {
  createDayThread,
  findOpenNominationForNominee,
  loadEngine,
  persistEvents,
  postNominationEverywhere,
  refreshNominationEverywhere,
  replyEngineError,
  resolvePlayerRef,
  syncGameProjection,
} from "./commands/command-context.js";
import { buildDayIntroEmbed } from "./day-thread.js";

export async function runSetPlayerVote(options: {
  interaction: CommandInteraction;
  gameId: string;
  guild: Guild | null;
  voterUserId?: string;
  voterSeat?: number | null;
  nomineeUserId?: string;
  nomineeSeat?: number | null;
  choice: VoteChoice;
  reason?: string | null;
}): Promise<boolean> {
  const {
    interaction,
    gameId,
    guild,
    voterUserId,
    voterSeat,
    nomineeUserId,
    nomineeSeat,
    choice,
    reason,
  } = options;

  if (!voterUserId && voterSeat == null) {
    await interaction.reply({
      content: "Provide a voter (`voter` or `voter_seat`).",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (!nomineeUserId && nomineeSeat == null) {
    await interaction.reply({
      content: "Provide a nominee (`nominee` or `nominee_seat`).",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  try {
    const engine = await loadEngine(gameId);
    const voter = resolvePlayerRef(engine, { userId: voterUserId, seat: voterSeat });
    if (!voter) {
      await interaction.reply({ content: "Could not find that voter in the game.", flags: MessageFlags.Ephemeral });
      return false;
    }

    const nominee = resolvePlayerRef(engine, { userId: nomineeUserId, seat: nomineeSeat });
    if (!nominee) {
      await interaction.reply({ content: "Could not find that nominee in the game.", flags: MessageFlags.Ephemeral });
      return false;
    }

    const nomination = findOpenNominationForNominee(engine, nominee.id);
    if (!nomination) {
      await interaction.reply({
        content: "That player does not have an open nomination.",
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    const events = engine.handle({
      kind: GameCommandKind.SetPlayerVote,
      gameId,
      voterId: voter.id,
      nominationId: nomination.id,
      choice,
      reason: reason?.trim() ?? null,
    });
    await persistEvents(engine, events);
    await syncGameProjection(gameId, engine);

    if (guild) {
      await refreshNominationEverywhere(
        guild,
        { id: gameId, channelId: engine.getState().channelId },
        engine,
        nomination.id,
      );
      const { postGameLogVoteCast } = await import("./game-log-thread.js");
      await postGameLogVoteCast(
        guild,
        { id: gameId, channelId: engine.getState().channelId },
        {
          voterDiscordId: voter.discordUserId,
          nomineeLabel: nominee.displayName,
          choice,
          ballot: "public",
          setByDiscordId: interaction.user.id,
        },
      );
    }

    await interaction.reply({
      content: `Set **${voter.displayName}** vote on **${nominee.displayName}** to **${choice}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  } catch (error) {
    await replyEngineError(interaction, error);
    return false;
  }
}

export async function runDevNominate(options: {
  interaction: CommandInteraction;
  gameId: string;
  guild: Guild | null;
  nominatorSeat: number;
  nomineeSeat: number;
  accusation: string;
}): Promise<void> {
  const { interaction, gameId, guild, nominatorSeat, nomineeSeat, accusation } = options;

  try {
    const engine = await loadEngine(gameId);
    const nominator = resolvePlayerRef(engine, { seat: nominatorSeat });
    const nominee = resolvePlayerRef(engine, { seat: nomineeSeat });
    if (!nominator || !nominee) {
      await interaction.reply({ content: "Invalid nominator or nominee seat.", flags: MessageFlags.Ephemeral });
      return;
    }

    const events = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: nominator.id,
      nomineeId: nominee.id,
      accusation,
    });
    await persistEvents(engine, events);

    const nominationId = engine.getState().day?.nominations.at(-1)?.id;
    if (nominationId && guild) {
      await postNominationEverywhere(
        guild,
        { id: gameId, channelId: engine.getState().channelId },
        engine,
        nominationId,
      );
    }

    await interaction.reply({
      content: `Recorded nomination: seat ${nominatorSeat} → seat ${nomineeSeat}.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }
}

export async function runDevKill(options: {
  interaction: CommandInteraction;
  gameId: string;
  seat?: number | null;
  userId?: string;
  cause: string;
}): Promise<void> {
  const { interaction, gameId, seat, userId, cause } = options;

  try {
    const engine = await loadEngine(gameId);
    const player = resolvePlayerRef(engine, { userId, seat });
    if (!player) {
      await interaction.reply({ content: "Could not find that player.", flags: MessageFlags.Ephemeral });
      return;
    }

    const events = engine.handle({
      kind: GameCommandKind.KillPlayer,
      gameId,
      playerId: player.id,
      cause,
    });
    await persistEvents(engine, events);
    await syncGameProjection(gameId, engine);

    await interaction.reply({
      content: `Marked **${player.displayName}** as dead (${cause}).`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }
}

export async function runDevDayStart(options: {
  interaction: CommandInteraction;
  gameId: string;
  channelId: string;
  guild: Guild;
}): Promise<void> {
  const { interaction, gameId, channelId, guild } = options;

  try {
    const engine = await loadEngine(gameId);
    const phaseEvents = engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "day",
    });
    await persistEvents(engine, phaseEvents);
    await syncGameProjection(gameId, engine);

    const dayNumber = engine.getState().dayNumber;
    let threadId = channelId;
    const gameRow = await prisma.game.findUnique({
      where: { id: gameId },
      select: { stRoleId: true },
    });
    const dayThread = await createDayThread(
      guild,
      channelId,
      gameId,
      dayNumber,
      engine,
      gameRow?.stRoleId,
    );
    if (dayThread) {
      threadId = dayThread.id;
      await dayThread.send({ embeds: [buildDayIntroEmbed(engine)] }).catch(() => undefined);
    }

    const openEvents = engine.handle({
      kind: GameCommandKind.OpenDay,
      gameId,
      discordThreadId: threadId,
    });
    await persistEvents(engine, openEvents);

    await interaction.reply({
      content: dayThread
        ? `Dev day ${dayNumber} started in <#${dayThread.id}>.`
        : `Dev day ${dayNumber} started (using this channel as day space).`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }
}

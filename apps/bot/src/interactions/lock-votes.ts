import { MessageFlags, type ButtonInteraction, type Guild } from "discord.js";
import { createReminder, getGameById, prisma } from "@grimkeeper/database";
import { GameCommandKind, type GameEngine } from "@grimkeeper/engine";

import {
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  replyEngineError,
  resolveVotingChannel,
  getStorytellerThread,
} from "../commands/command-context.js";
import {
  parseVoteTrackerButtonCustomId,
  upsertStVoteTracker,
  type VoteTrackerButtonAction,
} from "../st-vote-tracker.js";
import {
  INTERACTION_PENDING_CONTENT,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";

export async function handleLockVotesButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseVoteTrackerButtonCustomId(interaction.customId);
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
      await interaction.editReply({ content: "Only storytellers can use the vote tracker." });
      return true;
    }

    const reply = await runVoteTrackerAction(
      interaction.guild,
      game,
      engine,
      parsed.nominationId,
      parsed.action,
    );
    await interaction.editReply({ content: reply });
  } catch (error) {
    try {
      await replyEngineError(interaction, error);
    } catch (replyError) {
      if (!isRecoverableInteractionResponseError(replyError)) throw replyError;
    }
  }

  return true;
}

async function runVoteTrackerAction(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null; guildId: string },
  engine: GameEngine,
  nominationId: string,
  action: VoteTrackerButtonAction,
): Promise<string> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination || nomination.status !== "open") {
    return "That nomination is not open.";
  }

  if (action === "ping-missing") {
    return pingMissingVoters(guild, game, engine, nominationId);
  }
  if (action === "ping-hand") {
    return pingCountHand(guild, game, engine, nominationId, { force: true });
  }

  const kind =
    action === "lock"
      ? GameCommandKind.LockNominationVotes
      : action === "unlock"
        ? GameCommandKind.UnlockNominationVotes
        : action === "start-count"
          ? GameCommandKind.StartNominationCount
          : action === "count-yes" || action === "count-no"
            ? GameCommandKind.CountHandVote
            : action === "cancel-count"
              ? GameCommandKind.CancelNominationCount
              : null;

  if (!kind) {
    return "Unknown vote tracker action.";
  }

  const events =
    kind === GameCommandKind.CountHandVote
      ? engine.handle({
          kind,
          gameId: game.id,
          nominationId,
          choice: action === "count-yes" ? "yes" : "no",
        })
      : engine.handle({ kind, gameId: game.id, nominationId });

  await persistEvents(engine, events);
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await refreshNominationEverywhere(guild, game, engine, nominationId);

  const updated = engine.getNominationById(nominationId);
  const order = updated?.order ?? nomination.order;

  if (action === "lock") {
    await cancelVoteDeadlineReminder(nominationId);
    return `Votes locked on nomination #${order}. Players can no longer change votes.`;
  }
  if (action === "unlock") {
    return `Votes unlocked on nomination #${order}.`;
  }
  if (action === "cancel-count") {
    return `Vote count cancelled on nomination #${order}.`;
  }
  if (action === "start-count") {
    const handNote = await pingCountHand(guild, game, engine, nominationId);
    return `Counting nomination #${order}. ${handNote}`;
  }
  if (action === "count-yes" || action === "count-no") {
    const finished = updated?.votesLocked;
    if (finished) {
      await cancelVoteDeadlineReminder(nominationId);
      return `Counted **${action === "count-yes" ? "yes" : "no"}** — nomination #${order} is locked.`;
    }
    const handNote = await pingCountHand(guild, game, engine, nominationId);
    return `Counted **${action === "count-yes" ? "yes" : "no"}**. ${handNote}`;
  }

  return `Updated nomination #${order}.`;
}

async function pingMissingVoters(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  nominationId: string,
): Promise<string> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return "Nomination not found.";

  const missing = engine
    .getPlayersMissingVotes(nominationId)
    .filter((player) => !player.isFake && !player.discordUserId.startsWith("dev:"));
  if (missing.length === 0) {
    return `No missing votes on nomination #${nomination.order}.`;
  }

  const voting = await resolveVotingChannel(guild, game, engine);
  if (!voting) {
    return "Could not find Town Voting to ping missing voters.";
  }

  const mentions = missing.map((player) => `<@${player.discordUserId}>`).join(" ");
  await voting.send({
    content: `${mentions} — still need your vote on nomination **#${nomination.order}**.`,
    allowedMentions: { users: missing.map((player) => player.discordUserId) },
  });
  return `Pinged **${missing.length}** missing voter${missing.length === 1 ? "" : "s"} in Town Voting.`;
}

async function pingCountHand(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  nominationId: string,
  options?: { force?: boolean },
): Promise<string> {
  const nomination = engine.getNominationById(nominationId);
  const hand = engine.getCountHandPlayer(nominationId);
  if (!nomination || !hand) {
    return options?.force ? "No voter currently under the hand." : "";
  }
  if (hand.isFake || hand.discordUserId.startsWith("dev:")) {
    return `Hand is on **${hand.displayName}** (fake — no Discord ping).`;
  }

  const voting = await resolveVotingChannel(guild, game, engine);
  if (!voting) {
    return `Hand is on **${hand.displayName}** (Town Voting unavailable).`;
  }

  await voting.send({
    content: `<@${hand.discordUserId}> — the vote count hand is on you for nomination **#${nomination.order}**.`,
    allowedMentions: { users: [hand.discordUserId] },
  });
  return `Hand on <@${hand.discordUserId}>.`;
}

export async function scheduleNominationVoteDeadlineReminder(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null; guildId: string },
  engine: GameEngine,
  nominationId: string,
): Promise<void> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination?.voteDeadlineAt) return;

  const kib =
    (await getStorytellerThread(guild, game.channelId, {
      kibThreadId: game.kibThreadId,
      gameId: game.id,
    })) ?? null;
  if (!kib) return;

  const stIds = engine.getStorytellerDiscordIds();
  const stMentions = stIds.map((id) => `<@${id}>`).join(" ");
  const nominee = engine.getPlayerById(nomination.nomineeId);

  await createReminder({
    gameId: game.id,
    guildId: game.guildId,
    channelId: kib.id,
    message: `${stMentions} Nomination #${nomination.order} (${nominee?.displayName ?? "nominee"}) hit the 24h vote deadline — check the vote on the tracker.`
      .replace(/\s+/g, " ")
      .trim(),
    fireAt: new Date(nomination.voteDeadlineAt),
    createdBy: "system:vote-deadline",
    pingPlayers: false,
    sourceKey: voteDeadlineSourceKey(nominationId),
  });
}

export async function cancelVoteDeadlineReminder(nominationId: string): Promise<void> {
  await prisma.gameReminder
    .updateMany({
      where: { sourceKey: voteDeadlineSourceKey(nominationId), fired: false },
      data: { fired: true, sourceKey: null },
    })
    .catch(() => undefined);
}

function voteDeadlineSourceKey(nominationId: string): string {
  return `vote-deadline:${nominationId}`;
}

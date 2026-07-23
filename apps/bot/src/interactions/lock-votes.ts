import { MessageFlags, type ButtonInteraction, type Guild } from "discord.js";
import { createReminder, getGameById, prisma } from "@grimkeeper/database";
import { GameCommandKind, type GameEngine } from "@grimkeeper/engine";

import {
  canActAsStoryteller,
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  refreshAllNominationEverywhere,
  replyEngineError,
  resolveActiveGameForInteraction,
  resolveVotingChannel,
  getStorytellerThread,
} from "../commands/command-context.js";
import {
  formatBlockContestSummary,
  formatNominationPhrase,
  formatNominationRef,
  resolveNominationMessageUrl,
} from "../day-thread.js";
import { postGameLog } from "../game-log-thread.js";
import {
  parseVoteTrackerButtonCustomId,
  upsertStVoteTracker,
  type VoteTrackerButtonAction,
} from "../st-vote-tracker.js";
import {
  INTERACTION_PENDING_CONTENT,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";

type TrackerGame = {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
  guildId: string;
  logThreadId?: string | null;
};

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

  let game = await getGameById(parsed.gameId);
  const gameOk =
    Boolean(game) && game!.guildId === interaction.guildId && game!.phase !== "ended";
  if (!gameOk) {
    const recovered = await resolveActiveGameForInteraction(interaction);
    if (recovered && recovered.guildId === interaction.guildId && recovered.phase !== "ended") {
      game = recovered;
    } else if (game?.phase === "ended" && game.guildId === interaction.guildId) {
      await interaction.editReply({ content: "That game has ended." }).catch(() => undefined);
      return true;
    } else {
      await interaction
        .editReply({
          content:
            "No matching game for this nomination (it may be from an older game). Refresh the vote tracker with `/st do votes`.",
        })
        .catch(() => undefined);
      return true;
    }
  }

  try {
    const engine = await loadEngine(game!.id);
    if (!(await canActAsStoryteller(interaction, game!, engine))) {
      await interaction.editReply({
        content: !game!.stRoleId
          ? "Only storytellers can use the vote tracker. This game has no ST role linked — ask an ST to `/st do add-st` you."
          : "Only storytellers can use the vote tracker. Need this game’s ST Discord role, `/st do add-st`, or `ALLOWED_USER_IDS`.",
      });
      return true;
    }

    const reply = await runVoteTrackerAction(
      interaction.guild,
      game!,
      engine,
      parsed.nominationId,
      parsed.action,
      interaction.user.id,
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

async function nominationLink(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  nominationId: string,
): Promise<string> {
  const voting = await resolveVotingChannel(guild, game, engine);
  const url = await resolveNominationMessageUrl(voting, nominationId);
  return formatNominationRef(engine, nominationId, url);
}

async function logVoteAction(
  guild: Guild,
  game: TrackerGame,
  actorId: string,
  message: string,
): Promise<void> {
  await postGameLog(guild, game, `<@${actorId}> ${message}`);
}

function formatNomineeNames(engine: GameEngine, nomineeIds: string[]): string {
  return nomineeIds
    .map((id) => engine.getPlayerById(id)?.displayName ?? "?")
    .join(", ");
}

function describeBlockContest(engine: GameEngine): string {
  return formatBlockContestSummary(engine);
}

function describeAnnounceResult(
  engine: GameEngine,
  nominationId: string,
): { summary: string; detail: string } {
  const nomination = engine.getNominationById(nominationId)!;
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const nomineeName = nominee?.displayName ?? "The nominee";
  const yesVotes = engine.getEffectiveYesVotes(nominationId);
  const living = engine.countLivingPlayers();
  const needed = engine.votesNeededOnTheBlock();
  const tally = engine.formatNominationTally(nominationId, { revealSecret: true });
  const phrase = formatNominationPhrase(engine, nominationId);
  const contest = engine.getBlockContest();

  let summary: string;
  if (contest.kind === "sole" && contest.leader.nominationId === nominationId) {
    summary = `**${nomineeName}** is **on the block** with **${yesVotes}** yes (needed ${needed} of ${living} alive).`;
  } else if (contest.kind === "tie" && contest.leaders.some((leader) => leader.nominationId === nominationId)) {
    const others = formatNomineeNames(
      engine,
      contest.leaders
        .filter((leader) => leader.nominationId !== nominationId)
        .map((leader) => leader.nomineeId),
    );
    summary =
      `**${nomineeName}** is **tied** on the block with **${yesVotes}** yes` +
      (others ? ` (also: ${others})` : "") +
      ` (needed ${needed} of ${living} alive) — nobody uniquely on the block.`;
  } else if (yesVotes >= needed) {
    const leaderNote =
      contest.kind === "sole"
        ? ` **${engine.getPlayerById(contest.leader.nomineeId)?.displayName ?? "?"}** remains on the block with **${contest.leader.yesVotes}** yes.`
        : contest.kind === "tie"
          ? ` Current tie: ${formatNomineeNames(engine, contest.leaders.map((l) => l.nomineeId))} at **${contest.yesVotes}** yes.`
          : "";
    summary = `**${nomineeName}** has majority (**${yesVotes}** yes) but is **not** uniquely on the block.${leaderNote}`;
  } else {
    const leaderNote =
      contest.kind === "sole"
        ? ` **${engine.getPlayerById(contest.leader.nomineeId)?.displayName ?? "?"}** is on the block with **${contest.leader.yesVotes}** yes.`
        : contest.kind === "tie"
          ? ` Current tie: ${formatNomineeNames(engine, contest.leaders.map((l) => l.nomineeId))} at **${contest.yesVotes}** yes.`
          : " Block is empty.";
    summary = `**${nomineeName}** is **not** on the block with **${yesVotes}** yes (needed ${needed} of ${living} alive).${leaderNote}`;
  }

  return {
    summary,
    detail: `${phrase} — ${tally}`,
  };
}

async function runVoteTrackerAction(
  guild: Guild,
  game: TrackerGame,
  engine: GameEngine,
  nominationId: string,
  action: VoteTrackerButtonAction,
  actorId: string,
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
  if (action === "announce-block") {
    return announceBlockResult(guild, game, engine, nominationId, actorId);
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

  const handBefore =
    action === "count-yes" || action === "count-no"
      ? engine.getCountHandPlayer(nominationId)
      : null;

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
  const nom = await nominationLink(guild, game, engine, nominationId);
  const phrase = formatNominationPhrase(engine, nominationId);

  if (action === "lock") {
    await cancelVoteDeadlineReminder(nominationId);
    await logVoteAction(
      guild,
      game,
      actorId,
      `locked votes on ${phrase}. ${describeBlockContest(engine)}`,
    );
    return `Votes locked on ${nom}. Players can no longer change votes.`;
  }
  if (action === "unlock") {
    await logVoteAction(guild, game, actorId, `unlocked votes on ${phrase}.`);
    return `Votes unlocked on ${nom}.`;
  }
  if (action === "cancel-count") {
    await logVoteAction(guild, game, actorId, `cancelled the vote count on ${phrase}.`);
    return `Vote count cancelled on ${nom}.`;
  }
  if (action === "start-count") {
    const hand = engine.getCountHandPlayer(nominationId);
    await logVoteAction(
      guild,
      game,
      actorId,
      `started the vote count on ${phrase}. Hand on **${hand?.displayName ?? "?"}**.`,
    );
    return `Counting ${nom}. Hand on **${hand?.displayName ?? "?"}** — press **Ping hand** when ready.`;
  }
  if (action === "count-yes" || action === "count-no") {
    const choice = action === "count-yes" ? "yes" : "no";
    const voterName = handBefore?.displayName ?? "?";
    const ghostNote =
      handBefore && !handBefore.alive
        ? action === "count-yes"
          ? " (took ghost vote)"
          : " (kept ghost vote)"
        : "";
    const finished = updated?.votesLocked;
    if (finished) {
      await cancelVoteDeadlineReminder(nominationId);
      await logVoteAction(
        guild,
        game,
        actorId,
        `counted **${choice}** for **${voterName}**${ghostNote} on ${phrase} — count finished / votes locked. ${describeBlockContest(engine)}`,
      );
      return `Counted **${choice}**${ghostNote} — ${nom} is locked.`;
    }
    const hand = engine.getCountHandPlayer(nominationId);
    await logVoteAction(
      guild,
      game,
      actorId,
      `counted **${choice}** for **${voterName}**${ghostNote} on ${phrase}. Next hand: **${hand?.displayName ?? "?"}**.`,
    );
    return `Counted **${choice}**${ghostNote}. Next hand: **${hand?.displayName ?? "?"}**.`;
  }

  return `Updated ${nom}.`;
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

  const voting = await resolveVotingChannel(guild, game, engine);
  const url = await resolveNominationMessageUrl(voting, nominationId);
  const nom = formatNominationRef(engine, nominationId, url);

  if (missing.length === 0) {
    return `No missing votes on ${nom}.`;
  }

  if (!voting) {
    return "Could not find Town Voting to ping missing voters.";
  }

  const mentions = missing.map((player) => `<@${player.discordUserId}>`).join(" ");
  await voting.send({
    content: `${mentions} — still need your vote on ${nom}.`,
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

  const url = await resolveNominationMessageUrl(voting, nominationId);
  const nom = formatNominationRef(engine, nominationId, url);

  await voting.send({
    content: `<@${hand.discordUserId}> — the vote count hand is on you for ${nom}.`,
    allowedMentions: { users: [hand.discordUserId] },
  });
  return `Hand on <@${hand.discordUserId}>.`;
}

async function announceBlockResult(
  guild: Guild,
  game: TrackerGame,
  engine: GameEngine,
  nominationId: string,
  actorId: string,
): Promise<string> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return "Nomination not found.";
  if (nomination.status !== "open") return "That nomination is already resolved.";
  if (!nomination.votesLocked) {
    return "Lock or finish the vote count before announcing the result.";
  }

  const { summary, detail } = describeAnnounceResult(engine, nominationId);

  const events = engine.handle({
    kind: GameCommandKind.ResolveNomination,
    gameId: game.id,
    nominationId,
  });
  await persistEvents(engine, events);
  await cancelVoteDeadlineReminder(nominationId);

  const resolved = engine.getNominationById(nominationId);
  const passed = resolved?.status === "resolved_pass";

  await refreshAllNominationEverywhere(guild, game, engine, { revealSecret: true });
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  const { upsertStControlPanel } = await import("../st-control-panel.js");
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  await logVoteAction(
    guild,
    game,
    actorId,
    `announced & resolved ${detail}: **${passed ? "passed" : "failed"}**.\n${summary}`,
  );

  const voting = await resolveVotingChannel(guild, game, engine);
  const nomUrl = await resolveNominationMessageUrl(voting, nominationId);
  const nom = formatNominationRef(engine, nominationId, nomUrl, { capitalize: true });
  if (voting) {
    await voting
      .send({
        content: `${nom}: **${passed ? "passed" : "failed"}**.\n${summary}`,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
    return `${summary}\nResolved as **${passed ? "passed" : "failed"}** — posted to Town Voting.`;
  }

  return `${summary}\nResolved as **${passed ? "passed" : "failed"}** (Town Voting unavailable — audit log only).`;
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
  const voting = await resolveVotingChannel(guild, game, engine);
  const url = await resolveNominationMessageUrl(voting, nominationId);

  await createReminder({
    gameId: game.id,
    guildId: game.guildId,
    channelId: kib.id,
    message: `${stMentions} ${formatNominationRef(engine, nominationId, url, { capitalize: true })} hit the 24h vote deadline — check the vote on the tracker.`
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

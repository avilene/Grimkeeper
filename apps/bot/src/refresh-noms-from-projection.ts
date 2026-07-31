import type { Guild } from "discord.js";
import {
  appendGameEvent,
  loadDayProjectionForRefresh,
} from "@grimkeeper/database";
import {
  GameEventType,
  type GameEngine,
  type GameEvent,
  type VoteChoice,
} from "@grimkeeper/engine";

import { findNominationMessage } from "./day-thread.js";
import {
  ensureVotingChannel,
  postNominationEverywhere,
  refreshAllNominationEverywhere,
  syncGameProjection,
  toJson,
} from "./commands/command-context.js";
import { logGameEvent } from "./game-events-log.js";
import { refreshGameStatusForEngine } from "./game-status.js";
import {
  cancelVoteDeadlineReminder,
  scheduleNominationVoteDeadlineReminder,
} from "./interactions/lock-votes.js";
import { log } from "./logger.js";

function isVoteChoice(value: string): value is VoteChoice {
  return value.trim().length > 0;
}

/** True when projection deadline differs from the engine (including null ↔ set). */
export function voteDeadlineChanged(
  engineDeadline: string | null | undefined,
  projectionDeadline: Date | null | undefined,
): boolean {
  const engMs = engineDeadline ? new Date(engineDeadline).getTime() : null;
  const projMs = projectionDeadline ? projectionDeadline.getTime() : null;
  return engMs !== projMs;
}

/** Open, unlocked nominations with a deadline keep a kib vote-deadline reminder. */
export function shouldKeepVoteDeadlineReminder(nomination: {
  status: string;
  votesLocked: boolean;
  voteDeadlineAt: string | null;
}): boolean {
  return (
    nomination.status === "open" &&
    !nomination.votesLocked &&
    Boolean(nomination.voteDeadlineAt)
  );
}

/** Append a raw event (already shaped) without going through handle(). */
async function appendAndApply(engine: GameEngine, event: GameEvent): Promise<void> {
  engine.apply(event);
  await appendGameEvent(engine.getState().gameId, event.type, toJson(event));
  logGameEvent(engine, event);
}

/**
 * Bring the event-sourced engine in line with admin/projection nomination + vote rows
 * for the current day, then sync the projection from the engine.
 */
export async function reconcileDayProjectionIntoEngine(
  engine: GameEngine,
): Promise<{ appended: number }> {
  const state = engine.getState();
  const dayNumber = state.dayNumber;
  if (dayNumber < 1) return { appended: 0 };

  const dayRow = await loadDayProjectionForRefresh(state.gameId, dayNumber);
  if (!dayRow) return { appended: 0 };

  let appended = 0;
  const now = () => new Date().toISOString();

  if (!state.day) {
    await appendAndApply(engine, {
      type: GameEventType.DayStarted,
      gameId: state.gameId,
      dayNumber,
      timestamp: now(),
    });
    appended += 1;
  }

  const day = engine.getState().day;
  if (!day) return { appended };

  if (dayRow.discordThreadId && day.discordThreadId !== dayRow.discordThreadId) {
    await appendAndApply(engine, {
      type: GameEventType.DayOpened,
      gameId: state.gameId,
      dayNumber,
      discordThreadId: dayRow.discordThreadId,
      timestamp: now(),
    });
    appended += 1;
  }

  for (const nom of dayRow.nominations) {
    const existing = engine.getNominationById(nom.id);
    const projDeadline = nom.voteDeadlineAt?.toISOString() ?? null;
    if (!existing) {
      await appendAndApply(engine, {
        type: GameEventType.NominationMade,
        gameId: state.gameId,
        nominationId: nom.id,
        nominatorId: nom.nominatorId,
        nomineeId: nom.nomineeId,
        accusation: nom.accusation,
        order: nom.order,
        voteDeadlineAt: projDeadline ?? undefined,
        timestamp: now(),
      });
      appended += 1;
    } else {
      if ((existing.accusation ?? "") !== (nom.accusation ?? "")) {
        await appendAndApply(engine, {
          type: GameEventType.AccusationUpdated,
          gameId: state.gameId,
          nominationId: nom.id,
          playerId: nom.nominatorId,
          accusation: nom.accusation,
          timestamp: now(),
        });
        appended += 1;
      }
      if ((existing.defense ?? null) !== (nom.defense ?? null) && nom.defense) {
        await appendAndApply(engine, {
          type: GameEventType.DefenseAdded,
          gameId: state.gameId,
          nominationId: nom.id,
          playerId: nom.nomineeId,
          defense: nom.defense,
          timestamp: now(),
        });
        appended += 1;
      }
      if (voteDeadlineChanged(existing.voteDeadlineAt, nom.voteDeadlineAt)) {
        await appendAndApply(engine, {
          type: GameEventType.NominationVoteDeadlineUpdated,
          gameId: state.gameId,
          nominationId: nom.id,
          voteDeadlineAt: projDeadline,
          timestamp: now(),
        });
        appended += 1;
      }
    }

    const afterNom = engine.getNominationById(nom.id);
    if (
      afterNom &&
      afterNom.status === "open" &&
      (nom.status === "resolved_pass" || nom.status === "resolved_fail")
    ) {
      await appendAndApply(engine, {
        type: GameEventType.NominationResolved,
        gameId: state.gameId,
        nominationId: nom.id,
        passed: nom.status === "resolved_pass",
        yesVotes: 0,
        livingCount: engine.getState().players.filter((player) => player.alive).length,
        timestamp: now(),
      });
      appended += 1;
    }

    for (const vote of nom.votes) {
      const isPrivate = vote.isPrivate;
      const choice = vote.choice && isVoteChoice(vote.choice) ? vote.choice : null;

      const readCurrentForBallot = () =>
        engine
          .getState()
          .day?.votes.find(
            (row) =>
              row.nominationId === nom.id &&
              row.voterId === vote.voterId &&
              row.isPrivate === isPrivate,
          );

      const before = readCurrentForBallot();
      if (
        choice &&
        !(
          before?.choice === choice &&
          (before.reason ?? null) === (vote.reason ?? null)
        )
      ) {
        await appendAndApply(engine, {
          type: GameEventType.VoteCast,
          gameId: state.gameId,
          nominationId: nom.id,
          voterId: vote.voterId,
          choice,
          reason: vote.reason,
          manualSet: true,
          privateBallot: isPrivate,
          timestamp: now(),
        });
        appended += 1;
      }
    }
  }

  if (appended > 0) {
    await syncGameProjection(state.gameId, engine);
    await refreshGameStatusForEngine(engine);
  }

  return { appended };
}

export type RefreshNomsResult = {
  appended: number;
  /** Nominations with no Town Voting embed before this run. */
  missing: number;
  /** Successfully recreated embeds in Town Voting. */
  posted: number;
  total: number;
  votingChannelId: string | null;
  /** First Discord/post error when recreate failed. */
  postError?: string;
};

/**
 * Reconcile projection → events, recreate missing embeds for open noms on the current day,
 * then refresh all current-day nomination embeds.
 */
export async function refreshNominationsFromProjection(
  guild: Guild,
  game: {
    id: string;
    channelId: string;
    kibThreadId?: string | null;
    guildId?: string;
    votingThreadId?: string | null;
    playerRoleId?: string | null;
    stRoleId?: string | null;
    kibRoleId?: string | null;
  },
  engine: GameEngine,
): Promise<RefreshNomsResult> {
  const { appended } = await reconcileDayProjectionIntoEngine(engine);
  const dayNominations = engine.getState().day?.nominations ?? [];
  const openNominationIds = dayNominations
    .filter((nomination) => nomination.status === "open")
    .map((nomination) => nomination.id);

  const ensured = await ensureVotingChannel(guild, game, engine);
  game = ensured.game;
  const voting = ensured.channel;
  let missing = 0;
  let posted = 0;
  let postError: string | undefined;

  if (voting) {
    for (const nominationId of openNominationIds) {
      // Search deeper than a single page so older day traffic doesn't look "missing".
      const existing = await findNominationMessage(voting, nominationId, {
        limit: 100,
        maxPages: 5,
      });
      if (existing) continue;
      missing += 1;
      const result = await postNominationEverywhere(guild, game, engine, nominationId);
      if (result.voteThread) {
        posted += 1;
      } else {
        postError ??= result.error ?? "Unknown Discord send failure.";
        log("warn", "refreshNoms.postMissing.failed", {
          gameId: game.id,
          nominationId,
          votingChannelId: voting.id,
          error: result.error,
        });
      }
    }
  } else if (openNominationIds.length > 0) {
    missing = openNominationIds.length;
    postError = "Could not resolve Town Voting thread.";
    log("warn", "refreshNoms.noVotingChannel", {
      gameId: game.id,
      open: openNominationIds.length,
      votingThreadId: game.votingThreadId ?? null,
      dayThreadId: engine.getState().day?.discordThreadId ?? null,
    });
  }

  // Refresh embeds for the current day (open + resolved); only open noms are recreated above.
  await refreshAllNominationEverywhere(guild, game, engine);

  // Reschedule (or cancel) vote-deadline kib reminders from the latest deadlines.
  // Skip locked/resolved noms so refresh does not resurrect a reminder cancelled on lock.
  for (const nomination of dayNominations) {
    if (!shouldKeepVoteDeadlineReminder(nomination)) {
      await cancelVoteDeadlineReminder(nomination.id);
      continue;
    }
    await scheduleNominationVoteDeadlineReminder(
      guild,
      {
        id: game.id,
        channelId: game.channelId,
        kibThreadId: game.kibThreadId,
        guildId: game.guildId ?? engine.getState().guildId,
      },
      engine,
      nomination.id,
    ).catch(() => undefined);
  }

  return {
    appended,
    missing,
    posted,
    total: openNominationIds.length,
    votingChannelId: voting?.id ?? null,
    postError,
  };
}

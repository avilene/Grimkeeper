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
  postNominationEverywhere,
  refreshAllNominationEverywhere,
  resolveVotingChannel,
  syncGameProjection,
  toJson,
} from "./commands/command-context.js";
import { logGameEvent } from "./game-events-log.js";
import { refreshGameStatusForEngine } from "./game-status.js";

function isVoteChoice(value: string): value is VoteChoice {
  return value === "yes" || value === "no" || value === "conditional";
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
    if (!existing) {
      await appendAndApply(engine, {
        type: GameEventType.NominationMade,
        gameId: state.gameId,
        nominationId: nom.id,
        nominatorId: nom.nominatorId,
        nomineeId: nom.nomineeId,
        accusation: nom.accusation,
        order: nom.order,
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
      if (!isVoteChoice(vote.choice)) continue;
      const current = engine
        .getState()
        .day?.votes.find(
          (row) => row.nominationId === nom.id && row.voterId === vote.voterId,
        );
      if (
        current &&
        current.choice === vote.choice &&
        (current.reason ?? null) === (vote.reason ?? null)
      ) {
        continue;
      }
      await appendAndApply(engine, {
        type: GameEventType.VoteCast,
        gameId: state.gameId,
        nominationId: nom.id,
        voterId: vote.voterId,
        choice: vote.choice,
        reason: vote.reason,
        manualSet: true,
        privateBallot: false,
        timestamp: now(),
      });
      appended += 1;
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
  posted: number;
  total: number;
};

/**
 * Reconcile projection → events, post any missing Town Voting embeds, then refresh all.
 */
export async function refreshNominationsFromProjection(
  guild: Guild,
  game: {
    id: string;
    channelId: string;
    kibThreadId?: string | null;
    guildId?: string;
    playerRoleId?: string | null;
    stRoleId?: string | null;
    kibRoleId?: string | null;
  },
  engine: GameEngine,
): Promise<RefreshNomsResult> {
  const { appended } = await reconcileDayProjectionIntoEngine(engine);
  const nominationIds = engine.getState().day?.nominations.map((nomination) => nomination.id) ?? [];

  const voting = await resolveVotingChannel(guild, game, engine);
  let posted = 0;

  if (voting) {
    for (const nominationId of nominationIds) {
      const existing = await findNominationMessage(voting, nominationId);
      if (existing) continue;
      const result = await postNominationEverywhere(guild, game, engine, nominationId);
      if (result.voteThread) posted += 1;
    }
  }

  await refreshAllNominationEverywhere(guild, game, engine);
  return { appended, posted, total: nominationIds.length };
}

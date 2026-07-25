import { getBotcRole, type GameEngine, type GameState } from "@grimkeeper/engine";

import { prisma } from "./client.js";

export function shouldSyncDayState(state: GameState): boolean {
  return state.day !== null && state.phase === "day";
}

/** Default alignment from character catalog when Player.team is unset. */
export function teamFromRoleId(roleId: string | null | undefined): string | null {
  if (!roleId) return null;
  const role = getBotcRole(roleId);
  if (!role) return null;
  if (role.team === "traveler") return "traveler";
  if (role.team === "minion" || role.team === "demon") return "evil";
  return "good";
}

export async function syncGameProjectionFromEngine(
  gameId: string,
  engine: GameEngine,
): Promise<void> {
  const state = engine.getState();

  await prisma.game.update({
    where: { id: gameId },
    data: {
      phase: state.phase,
      dayNumber: state.dayNumber,
      nightNumber: state.nightNumber,
      winner: state.winner,
    },
  });

  for (const player of state.players) {
    const existing = await prisma.player.findFirst({
      where: { id: player.id, gameId },
      select: { team: true },
    });
    if (!existing) continue;

    const team = existing.team ?? teamFromRoleId(player.roleId);

    await prisma.player.update({
      where: { id: player.id },
      data: {
        seat: player.seat,
        roleId: player.roleId,
        alive: player.alive,
        ghostVoteUsed: player.ghostVoteUsed,
        displayName: player.displayName,
        ...(team !== existing.team ? { team } : {}),
      },
    });
  }

  if (!shouldSyncDayState(state) || !state.day) {
    return;
  }

  const day = state.day;
  const pausedUntil = day.nominationsPausedUntil ? new Date(day.nominationsPausedUntil) : null;

  const gameDay = await prisma.gameDay.upsert({
    where: {
      gameId_dayNumber: {
        gameId,
        dayNumber: day.dayNumber,
      },
    },
    create: {
      gameId,
      dayNumber: day.dayNumber,
      discordThreadId: day.discordThreadId,
      nominationsOpen: day.nominationsOpen,
      voteVisibility: day.voteVisibility,
      executionUsed: day.executionUsed,
      nominationsPausedUntil: pausedUntil,
    },
    update: {
      discordThreadId: day.discordThreadId,
      nominationsOpen: day.nominationsOpen,
      voteVisibility: day.voteVisibility,
      executionUsed: day.executionUsed,
      nominationsPausedUntil: pausedUntil,
    },
  });

  const nominationIds = day.nominations.map((nomination) => nomination.id);

  for (const nomination of day.nominations) {
    await prisma.nomination.upsert({
      where: { id: nomination.id },
      create: {
        id: nomination.id,
        gameDayId: gameDay.id,
        nominatorId: nomination.nominatorId,
        nomineeId: nomination.nomineeId,
        accusation: nomination.accusation,
        defense: nomination.defense,
        order: nomination.order,
        status: nomination.status,
      },
      update: {
        accusation: nomination.accusation,
        defense: nomination.defense,
        status: nomination.status,
        order: nomination.order,
        nominatorId: nomination.nominatorId,
        nomineeId: nomination.nomineeId,
      },
    });
  }

  if (nominationIds.length > 0) {
    await prisma.nomination.deleteMany({
      where: {
        gameDayId: gameDay.id,
        id: { notIn: nominationIds },
      },
    });
  } else {
    await prisma.nomination.deleteMany({
      where: { gameDayId: gameDay.id },
    });
  }

  const voteKeys = new Set<string>();
  for (const vote of day.votes) {
    voteKeys.add(`${vote.nominationId}:${vote.voterId}`);
    const publicChoice =
      vote.publicChoice ?? (vote.privateChoice != null ? null : vote.choice);
    const privateChoice = vote.privateChoice ?? null;
    const existing = await prisma.vote.findUnique({
      where: {
        nominationId_voterId: {
          nominationId: vote.nominationId,
          voterId: vote.voterId,
        },
      },
    });

    if (existing) {
      await prisma.vote.update({
        where: { id: existing.id },
        data: {
          choice: publicChoice,
          reason: vote.reason,
          privateChoice,
          // Engine has a single reason; keep admin privateReason unless this was a private cast.
          privateReason:
            privateChoice != null && publicChoice == null ? vote.reason : existing.privateReason,
        },
      });
      continue;
    }

    await prisma.vote.create({
      data: {
        gameDayId: gameDay.id,
        nominationId: vote.nominationId,
        voterId: vote.voterId,
        choice: publicChoice,
        reason: vote.reason,
        privateChoice,
        privateReason: privateChoice != null && publicChoice == null ? vote.reason : null,
      },
    });
  }

  const dbVotes = await prisma.vote.findMany({
    where: { gameDayId: gameDay.id },
    select: { id: true, nominationId: true, voterId: true },
  });

  for (const dbVote of dbVotes) {
    const key = `${dbVote.nominationId}:${dbVote.voterId}`;
    if (!voteKeys.has(key)) {
      await prisma.vote.delete({ where: { id: dbVote.id } });
    }
  }
}

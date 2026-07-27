import { prisma } from "./client.js";
import { GAME_SOURCE_STATS_ONLY } from "./record-completed-game.js";

async function assertLiveDiscordGame(gameId: string): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, source: true },
  });
  if (!game) throw new Error("Game not found.");
  if (game.source === GAME_SOURCE_STATS_ONLY) {
    throw new Error("Stats-only games cannot push nominations to Discord.");
  }
}

/** Mark a game so the bot pushes nomination/vote projection state to Discord. */
export async function requestDiscordNomsRefresh(gameId: string): Promise<void> {
  await assertLiveDiscordGame(gameId);
  await prisma.game.update({
    where: { id: gameId },
    data: { discordNomsRefreshRequestedAt: new Date() },
  });
}

/** Games waiting for a Discord nomination refresh (oldest first). */
export async function listGamesPendingDiscordNomsRefresh(limit = 10) {
  return prisma.game.findMany({
    where: {
      discordNomsRefreshRequestedAt: { not: null },
      // Skip admin-recorded stats-only games (never post to Discord).
      OR: [{ source: null }, { source: { not: GAME_SOURCE_STATS_ONLY } }],
    },
    orderBy: { discordNomsRefreshRequestedAt: "asc" },
    take: limit,
    select: {
      id: true,
      guildId: true,
      channelId: true,
      kibThreadId: true,
      votingThreadId: true,
      playerRoleId: true,
      stRoleId: true,
      kibRoleId: true,
      dayNumber: true,
      phase: true,
      discordNomsRefreshRequestedAt: true,
    },
  });
}

/** Clear the refresh flag only if it still matches the claimed timestamp. */
export async function clearDiscordNomsRefreshRequest(
  gameId: string,
  requestedAt: Date,
): Promise<boolean> {
  const result = await prisma.game.updateMany({
    where: { id: gameId, discordNomsRefreshRequestedAt: requestedAt },
    data: { discordNomsRefreshRequestedAt: null },
  });
  return result.count > 0;
}

/** Ask the bot to delete+repost open nomination embeds in kib. */
export async function requestDiscordKibNomsRepost(gameId: string): Promise<void> {
  await assertLiveDiscordGame(gameId);
  await prisma.game.update({
    where: { id: gameId },
    data: { discordKibNomsRepostRequestedAt: new Date() },
  });
}

export async function listGamesPendingDiscordKibNomsRepost(limit = 10) {
  return prisma.game.findMany({
    where: {
      discordKibNomsRepostRequestedAt: { not: null },
      OR: [{ source: null }, { source: { not: GAME_SOURCE_STATS_ONLY } }],
    },
    orderBy: { discordKibNomsRepostRequestedAt: "asc" },
    take: limit,
    select: {
      id: true,
      guildId: true,
      channelId: true,
      kibThreadId: true,
      dayNumber: true,
      phase: true,
      discordKibNomsRepostRequestedAt: true,
    },
  });
}

export async function clearDiscordKibNomsRepostRequest(
  gameId: string,
  requestedAt: Date,
): Promise<boolean> {
  const result = await prisma.game.updateMany({
    where: { id: gameId, discordKibNomsRepostRequestedAt: requestedAt },
    data: { discordKibNomsRepostRequestedAt: null },
  });
  return result.count > 0;
}

/** Ask the bot to ping missing voters for one open nomination. */
export async function requestDiscordPingMissing(
  gameId: string,
  nominationId: string,
): Promise<void> {
  await assertLiveDiscordGame(gameId);
  await prisma.game.update({
    where: { id: gameId },
    data: {
      discordPingMissingRequestedAt: new Date(),
      discordPingMissingNominationId: nominationId,
    },
  });
}

export async function listGamesPendingDiscordPingMissing(limit = 10) {
  return prisma.game.findMany({
    where: {
      discordPingMissingRequestedAt: { not: null },
      discordPingMissingNominationId: { not: null },
      OR: [{ source: null }, { source: { not: GAME_SOURCE_STATS_ONLY } }],
    },
    orderBy: { discordPingMissingRequestedAt: "asc" },
    take: limit,
    select: {
      id: true,
      guildId: true,
      channelId: true,
      kibThreadId: true,
      dayNumber: true,
      phase: true,
      discordPingMissingRequestedAt: true,
      discordPingMissingNominationId: true,
    },
  });
}

export async function clearDiscordPingMissingRequest(
  gameId: string,
  requestedAt: Date,
): Promise<boolean> {
  const result = await prisma.game.updateMany({
    where: { id: gameId, discordPingMissingRequestedAt: requestedAt },
    data: {
      discordPingMissingRequestedAt: null,
      discordPingMissingNominationId: null,
    },
  });
  return result.count > 0;
}

/** Current-day nomination + vote rows for Discord reconcile. */
export async function loadDayProjectionForRefresh(gameId: string, dayNumber: number) {
  return prisma.gameDay.findUnique({
    where: { gameId_dayNumber: { gameId, dayNumber } },
    include: {
      nominations: {
        orderBy: { order: "asc" },
        include: { votes: true },
      },
    },
  });
}

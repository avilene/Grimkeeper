import { prisma } from "./client.js";
import { GAME_SOURCE_STATS_ONLY } from "./record-completed-game.js";

/** Mark a game so the bot pushes nomination/vote projection state to Discord. */
export async function requestDiscordNomsRefresh(gameId: string): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, source: true },
  });
  if (!game) throw new Error("Game not found.");
  if (game.source === GAME_SOURCE_STATS_ONLY) {
    throw new Error("Stats-only games cannot push nominations to Discord.");
  }
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

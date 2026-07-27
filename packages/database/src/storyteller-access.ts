import {
  GameEngine,
  GameEventType,
  getStorytellerDiscordIds,
  type GameEvent,
} from "@grimkeeper/engine";

import { prisma } from "./client.js";

/**
 * Game ids where `discordUserId` is currently an engine storyteller
 * (primary or promoted), based on replaying ST-related events.
 */
export async function listEngineStorytellerGameIds(
  discordUserId: string,
): Promise<string[]> {
  const userId = discordUserId.trim();
  if (!userId) return [];

  // Candidate games: any ST lifecycle event mentioning this user.
  const candidates = await prisma.gameEvent.findMany({
    where: {
      type: {
        in: [
          GameEventType.GameCreated,
          GameEventType.StorytellerPromoted,
          GameEventType.StorytellerDemoted,
        ],
      },
    },
    select: { gameId: true, type: true, payload: true },
  });

  const candidateGameIds = new Set<string>();
  for (const row of candidates) {
    const payload = row.payload as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") continue;
    if (row.type === GameEventType.GameCreated) {
      if (payload.storytellerId === userId) candidateGameIds.add(row.gameId);
    } else if (
      row.type === GameEventType.StorytellerPromoted ||
      row.type === GameEventType.StorytellerDemoted
    ) {
      if (payload.discordUserId === userId) candidateGameIds.add(row.gameId);
    }
  }

  if (candidateGameIds.size === 0) return [];

  const confirmed: string[] = [];
  for (const gameId of candidateGameIds) {
    const rows = await prisma.gameEvent.findMany({
      where: { gameId },
      orderBy: { seq: "asc" },
      select: { payload: true },
    });
    const events = rows.map((row) => row.payload as unknown as GameEvent);
    if (events.length === 0) continue;
    try {
      const engine = GameEngine.fromEvents(gameId, events);
      if (getStorytellerDiscordIds(engine.getState()).includes(userId)) {
        confirmed.push(gameId);
      }
    } catch {
      // Corrupt / incomplete history — skip.
    }
  }

  return confirmed;
}

/** Games that have a Discord ST role configured (for role-based access checks). */
export async function listGamesWithStRole(): Promise<
  Array<{ id: string; guildId: string; stRoleId: string }>
> {
  const games = await prisma.game.findMany({
    where: { stRoleId: { not: null } },
    select: { id: true, guildId: true, stRoleId: true },
  });
  return games
    .filter((game): game is { id: string; guildId: string; stRoleId: string } =>
      Boolean(game.stRoleId),
    )
    .map((game) => ({
      id: game.id,
      guildId: game.guildId,
      stRoleId: game.stRoleId!,
    }));
}

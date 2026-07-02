import { prisma } from "./client.js";
import type { GameEvent, Prisma } from "./generated/prisma/client.js";

export { prisma, PrismaClient } from "./client.js";
export type { GameEvent, Prisma } from "./generated/prisma/client.js";
export { bindPrismaLogging, type DbLogFn, type DbLogLevel } from "./logging.js";

export type StoredGameEvent = GameEvent;

export async function appendGameEvent(
  gameId: string,
  type: string,
  payload: Prisma.InputJsonValue,
): Promise<StoredGameEvent> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.gameEvent.findFirst({
      where: { gameId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;

    return tx.gameEvent.create({
      data: { gameId, type, payload, seq },
    });
  });
}

export async function getGameEvents(gameId: string): Promise<StoredGameEvent[]> {
  return prisma.gameEvent.findMany({
    where: { gameId },
    orderBy: { seq: "asc" },
  });
}

export async function getActiveGameForGuild(guildId: string) {
  return prisma.game.findFirst({
    where: { guildId, phase: { not: "ended" } },
    include: { players: true, events: { orderBy: { seq: "asc" } } },
  });
}

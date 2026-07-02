import { PrismaClient, type GameEvent, type Prisma } from "@prisma/client";

export * from "@prisma/client";
export { bindPrismaLogging, type DbLogFn, type DbLogLevel } from "./logging.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prismaLogLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === "development"
    ? ["warn", "error", "info", "query"]
    : ["warn", "error"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLogLevels.map((level) => ({ emit: "event", level })),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

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

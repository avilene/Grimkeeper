import { prisma, type Prisma } from "./client.js";

export type WriteAppLogInput = {
  level: string;
  message: string;
  gameId?: string | null;
  context?: unknown;
};

export async function writeAppLog(input: WriteAppLogInput): Promise<void> {
  let context: Prisma.InputJsonValue | undefined;
  if (input.context != null) {
    try {
      context = JSON.parse(JSON.stringify(input.context)) as Prisma.InputJsonValue;
    } catch {
      context = { note: "context_not_serializable" };
    }
  }

  await prisma.appLog.create({
    data: {
      level: input.level,
      message: input.message,
      gameId: input.gameId ?? null,
      context,
    },
  });
}

export type ListAppLogsFilter = {
  level?: string;
  gameId?: string;
  since?: Date;
  until?: Date;
  take?: number;
};

export async function listAppLogs(filter: ListAppLogsFilter = {}) {
  const take = Math.min(Math.max(filter.take ?? 100, 1), 500);
  return prisma.appLog.findMany({
    where: {
      ...(filter.level ? { level: filter.level } : {}),
      ...(filter.gameId ? { gameId: filter.gameId } : {}),
      ...((filter.since || filter.until)
        ? {
            createdAt: {
              ...(filter.since ? { gte: filter.since } : {}),
              ...(filter.until ? { lte: filter.until } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export type ListGameEventsFilter = {
  gameId?: string;
  type?: string;
  since?: Date;
  until?: Date;
  take?: number;
};

export async function listGameEvents(filter: ListGameEventsFilter = {}) {
  const take = Math.min(Math.max(filter.take ?? 100, 1), 500);
  return prisma.gameEvent.findMany({
    where: {
      ...(filter.gameId ? { gameId: filter.gameId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...((filter.since || filter.until)
        ? {
            createdAt: {
              ...(filter.since ? { gte: filter.since } : {}),
              ...(filter.until ? { lte: filter.until } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
    take,
  });
}

export async function listDistinctGameEventTypes(): Promise<string[]> {
  const rows = await prisma.gameEvent.findMany({
    distinct: ["type"],
    select: { type: true },
    orderBy: { type: "asc" },
  });
  return rows.map((row) => row.type);
}

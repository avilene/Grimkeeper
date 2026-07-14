import { Prisma } from "./generated/prisma/client.js";
import { prisma } from "./client.js";

export type ReminderScope =
  | { kind: "game"; gameId: string; guildId: string; channelId: string; channelIds: string[] }
  | { kind: "channel"; guildId: string; channelId: string };

export interface CreateReminderInput {
  gameId?: string | null;
  guildId: string;
  channelId: string;
  message: string;
  emoji?: string | null;
  sourceKey?: string | null;
  fireAt: Date;
  seriesEndAt?: Date | null;
  createdBy: string;
  pingPlayers?: boolean;
  pingRoleId?: string | null;
}

function scopeWhere(scope: ReminderScope): Prisma.GameReminderWhereInput {
  if (scope.kind === "game") {
    return {
      fired: false,
      OR: [
        { gameId: scope.gameId, channelId: { in: scope.channelIds } },
        { gameId: null, guildId: scope.guildId, channelId: { in: scope.channelIds } },
      ],
    };
  }
  return { gameId: null, guildId: scope.guildId, channelId: scope.channelId, fired: false };
}

function matchesIdPrefix(id: string, idPrefix: string): boolean {
  return id.toLowerCase().startsWith(idPrefix.trim().toLowerCase());
}

export async function createReminder(input: CreateReminderInput) {
  if (input.sourceKey) {
    const existing = await prisma.gameReminder.findUnique({
      where: { sourceKey: input.sourceKey },
    });
    if (existing) return existing;
  }

  try {
    return await prisma.gameReminder.create({
      data: {
        ...input,
        gameId: input.gameId ?? null,
        sourceKey: input.sourceKey ?? null,
      },
    });
  } catch (error) {
    if (
      input.sourceKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.gameReminder.findUniqueOrThrow({
        where: { sourceKey: input.sourceKey },
      });
    }
    throw error;
  }
}

/** @deprecated Use createReminder */
export async function createGameReminder(input: CreateReminderInput & { gameId: string }) {
  return createReminder(input);
}

export async function listDueReminders(now = new Date()) {
  return prisma.gameReminder.findMany({
    where: {
      fired: false,
      fireAt: { lte: now },
    },
    orderBy: { fireAt: "asc" },
    take: 25,
  });
}

export async function markReminderFired(id: string) {
  return prisma.gameReminder.update({
    where: { id },
    data: { fired: true },
  });
}

/** Atomically mark a due reminder as fired; returns false if another worker already claimed it. */
export async function claimReminderForFire(id: string): Promise<boolean> {
  const result = await prisma.gameReminder.updateMany({
    where: { id, fired: false },
    data: { fired: true },
  });
  return result.count > 0;
}

export async function cancelGameReminders(gameId: string) {
  const result = await prisma.gameReminder.updateMany({
    where: { gameId, fired: false },
    data: { fired: true },
  });
  return result.count;
}

export interface CancelRemindersFilter {
  channelId?: string;
  message?: string;
  idPrefix?: string;
}

export async function cancelReminders(scope: ReminderScope, filter?: CancelRemindersFilter) {
  if (filter?.idPrefix) {
    const idPrefix = filter.idPrefix;
    const reminders = await prisma.gameReminder.findMany({
      where: scopeWhere(scope),
      select: { id: true, channelId: true, message: true },
    });

    const ids = reminders
      .filter((reminder) => {
        if (filter.channelId && reminder.channelId !== filter.channelId) return false;
        if (filter.message && reminder.message !== filter.message) return false;
        return matchesIdPrefix(reminder.id, idPrefix);
      })
      .map((reminder) => reminder.id);

    if (ids.length === 0) return 0;

    const result = await prisma.gameReminder.updateMany({
      where: { id: { in: ids }, fired: false },
      data: { fired: true },
    });
    return result.count;
  }

  const where: Prisma.GameReminderWhereInput = { ...scopeWhere(scope) };
  if (filter?.channelId) where.channelId = filter.channelId;
  if (filter?.message) where.message = filter.message;

  const result = await prisma.gameReminder.updateMany({
    where,
    data: { fired: true },
  });
  return result.count;
}

export async function countPendingReminders(scope: ReminderScope) {
  return prisma.gameReminder.count({
    where: scopeWhere(scope),
  });
}

export async function listPendingReminders(scope: ReminderScope) {
  return prisma.gameReminder.findMany({
    where: scopeWhere(scope),
    orderBy: { fireAt: "asc" },
  });
}

/** Cancel by ID prefix; falls back to guild/game matches if the channel scope misses. */
export async function cancelReminderByIdPrefix(scope: ReminderScope, idPrefix: string): Promise<number> {
  const cancelled = await cancelReminders(scope, { idPrefix });
  if (cancelled > 0) return cancelled;

  if (scope.kind !== "game") return 0;

  const guildChannelReminders = await prisma.gameReminder.findMany({
    where: { gameId: null, guildId: scope.guildId, fired: false },
    select: { id: true },
  });
  const channelMatches = guildChannelReminders.filter((reminder) =>
    matchesIdPrefix(reminder.id, idPrefix),
  );
  if (channelMatches.length > 0) {
    const result = await prisma.gameReminder.updateMany({
      where: { id: { in: channelMatches.map((reminder) => reminder.id) }, fired: false },
      data: { fired: true },
    });
    return result.count;
  }

  const reminders = await prisma.gameReminder.findMany({
    where: { gameId: scope.gameId, fired: false },
    select: { id: true },
  });
  const matches = reminders.filter((reminder) => matchesIdPrefix(reminder.id, idPrefix));
  if (matches.length === 0) return 0;

  const result = await prisma.gameReminder.updateMany({
    where: { id: { in: matches.map((reminder) => reminder.id) }, fired: false },
    data: { fired: true },
  });
  return result.count;
}

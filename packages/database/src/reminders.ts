import { Prisma } from "./generated/prisma/client.js";
import { prisma } from "./client.js";

export type ReminderScope =
  | { kind: "game"; gameId: string }
  | { kind: "channel"; guildId: string; channelId: string };

export interface CreateReminderInput {
  gameId?: string | null;
  guildId: string;
  channelId: string;
  message: string;
  emoji?: string | null;
  sourceKey?: string | null;
  fireAt: Date;
  createdBy: string;
  pingPlayers?: boolean;
  pingRoleId?: string | null;
}

function scopeWhere(scope: ReminderScope) {
  if (scope.kind === "game") {
    return { gameId: scope.gameId, fired: false as const };
  }
  return { gameId: null, guildId: scope.guildId, channelId: scope.channelId, fired: false as const };
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
  return cancelReminders({ kind: "game", gameId });
}

export interface CancelRemindersFilter {
  channelId?: string;
  message?: string;
  idPrefix?: string;
}

export async function cancelReminders(scope: ReminderScope, filter?: CancelRemindersFilter) {
  const reminders = await prisma.gameReminder.findMany({
    where: scopeWhere(scope),
    select: { id: true, channelId: true, message: true },
  });

  const toCancel = reminders.filter((reminder) => {
    if (filter?.channelId && reminder.channelId !== filter.channelId) return false;
    if (filter?.message && reminder.message !== filter.message) return false;
    if (filter?.idPrefix && !reminder.id.startsWith(filter.idPrefix)) return false;
    return true;
  });

  if (toCancel.length === 0) {
    return 0;
  }

  const result = await prisma.gameReminder.updateMany({
    where: { id: { in: toCancel.map((reminder) => reminder.id) } },
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

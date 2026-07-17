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
  const data = {
    gameId: input.gameId ?? null,
    guildId: input.guildId,
    channelId: input.channelId,
    message: input.message,
    emoji: input.emoji ?? null,
    sourceKey: input.sourceKey ?? null,
    fireAt: input.fireAt,
    seriesEndAt: input.seriesEndAt ?? null,
    createdBy: input.createdBy,
    pingPlayers: input.pingPlayers ?? false,
    pingRoleId: input.pingRoleId ?? null,
  };

  if (data.sourceKey) {
    const existing = await prisma.gameReminder.findUnique({
      where: { sourceKey: data.sourceKey },
    });
    if (existing) {
      if (!existing.fired) return existing;
      return prisma.gameReminder.update({
        where: { id: existing.id },
        data: { ...data, fired: false },
      });
    }
  }

  try {
    return await prisma.gameReminder.create({ data });
  } catch (error) {
    if (
      data.sourceKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.gameReminder.findUniqueOrThrow({
        where: { sourceKey: data.sourceKey },
      });
      if (!existing.fired) return existing;
      return prisma.gameReminder.update({
        where: { id: existing.id },
        data: { ...data, fired: false },
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
    data: { fired: true, sourceKey: null },
  });
  return result.count > 0;
}

/**
 * Claim one due reminder and mark same-channel/message/minute siblings fired so
 * stacked duplicate rows cannot send again (works across processes).
 */
export async function claimReminderAndDuplicates(reminder: {
  id: string;
  channelId: string;
  message: string;
  fireAt: Date;
}): Promise<boolean> {
  const claimed = await claimReminderForFire(reminder.id);
  if (!claimed) return false;

  const fireMinute = Math.floor(new Date(reminder.fireAt).getTime() / 60_000);
  const minuteStart = new Date(fireMinute * 60_000);
  const minuteEnd = new Date((fireMinute + 1) * 60_000);
  const normalized = reminder.message.trim().toLowerCase().replace(/\s+/g, " ");

  const siblings = await prisma.gameReminder.findMany({
    where: {
      id: { not: reminder.id },
      channelId: reminder.channelId,
      fired: false,
      fireAt: { gte: minuteStart, lt: minuteEnd },
    },
    select: { id: true, message: true },
  });
  const siblingIds = siblings
    .filter(
      (row) => row.message.trim().toLowerCase().replace(/\s+/g, " ") === normalized,
    )
    .map((row) => row.id);
  if (siblingIds.length > 0) {
    await prisma.gameReminder.updateMany({
      where: { id: { in: siblingIds } },
      data: { fired: true, sourceKey: null },
    });
  }
  return true;
}

export async function cancelGameReminders(gameId: string) {
  const result = await prisma.gameReminder.updateMany({
    where: { gameId, fired: false },
    data: { fired: true, sourceKey: null },
  });
  return result.count;
}

export interface CancelRemindersFilter {
  channelId?: string;
  message?: string;
  idPrefix?: string;
  /** When true, only cancel reminders created by `/st set-reminders` (have seriesEndAt). */
  batchOnly?: boolean;
}

export async function cancelReminders(scope: ReminderScope, filter?: CancelRemindersFilter) {
  if (filter?.idPrefix) {
    const idPrefix = filter.idPrefix;
    const reminders = await prisma.gameReminder.findMany({
      where: {
        ...scopeWhere(scope),
        ...(filter.batchOnly ? { seriesEndAt: { not: null } } : {}),
      },
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
      data: { fired: true, sourceKey: null },
    });
    return result.count;
  }

  const where: Prisma.GameReminderWhereInput = { ...scopeWhere(scope) };
  if (filter?.channelId) where.channelId = filter.channelId;
  if (filter?.message) where.message = filter.message;
  if (filter?.batchOnly) where.seriesEndAt = { not: null };

  const result = await prisma.gameReminder.updateMany({
    where,
    data: { fired: true, sourceKey: null },
  });
  return result.count;
}

/**
 * Cancel all pending set-reminders batch rows in a channel (any gameId), then create
 * replacements in one transaction so parallel handlers cannot stack batches.
 */
export async function replaceChannelBatchReminders(
  guildId: string,
  channelId: string,
  creates: CreateReminderInput[],
): Promise<{ replaced: number }> {
  return prisma.$transaction(async (tx) => {
    const cancelled = await tx.gameReminder.updateMany({
      where: {
        guildId,
        channelId,
        fired: false,
        seriesEndAt: { not: null },
      },
      data: { fired: true, sourceKey: null },
    });

    for (const input of creates) {
      const data = {
        gameId: input.gameId ?? null,
        guildId: input.guildId,
        channelId: input.channelId,
        message: input.message,
        emoji: input.emoji ?? null,
        sourceKey: input.sourceKey ?? null,
        fireAt: input.fireAt,
        seriesEndAt: input.seriesEndAt ?? null,
        createdBy: input.createdBy,
        pingPlayers: input.pingPlayers ?? false,
        pingRoleId: input.pingRoleId ?? null,
      };

      if (data.sourceKey) {
        const existing = await tx.gameReminder.findUnique({
          where: { sourceKey: data.sourceKey },
        });
        if (existing) {
          await tx.gameReminder.update({
            where: { id: existing.id },
            data: { ...data, fired: false },
          });
          continue;
        }
      }

      await tx.gameReminder.create({ data });
    }

    return { replaced: cancelled.count };
  });
}

/** Stable key by hour offset so parallel set-reminders runs upsert instead of stacking. */
export function batchReminderSourceKey(
  guildId: string,
  channelId: string,
  hourOffset: number,
  message: string,
): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const hour = Number(hourOffset.toFixed(4));
  return `set:${guildId}:${channelId}:h${hour}:${normalized}`;
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

export async function findRemindersByIdPrefix(scope: ReminderScope, idPrefix: string) {
  const trimmed = idPrefix.trim();
  if (!trimmed) return [];

  const inScope = await listPendingReminders(scope);
  const matches = inScope.filter((reminder) => matchesIdPrefix(reminder.id, trimmed));
  if (matches.length > 0) return matches;

  if (scope.kind !== "game") return [];

  const guildChannelReminders = await prisma.gameReminder.findMany({
    where: { gameId: null, guildId: scope.guildId, fired: false },
  });
  const channelMatches = guildChannelReminders.filter((reminder) =>
    matchesIdPrefix(reminder.id, trimmed),
  );
  if (channelMatches.length > 0) return channelMatches;

  const gameReminders = await prisma.gameReminder.findMany({
    where: { gameId: scope.gameId, fired: false },
  });
  return gameReminders.filter((reminder) => matchesIdPrefix(reminder.id, trimmed));
}

export interface UpdateReminderInput {
  message?: string;
  fireAt?: Date;
  pingPlayers?: boolean;
  pingRoleId?: string | null;
}

export async function updateReminder(id: string, input: UpdateReminderInput) {
  return prisma.gameReminder.update({
    where: { id },
    data: input,
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
      data: { fired: true, sourceKey: null },
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
    data: { fired: true, sourceKey: null },
  });
  return result.count;
}

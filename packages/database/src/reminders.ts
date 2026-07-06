import { prisma } from "./client.js";

export interface CreateReminderInput {
  gameId: string;
  guildId: string;
  channelId: string;
  message: string;
  fireAt: Date;
  createdBy: string;
}

export async function createGameReminder(input: CreateReminderInput) {
  return prisma.gameReminder.create({
    data: input,
  });
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

export async function cancelGameReminders(gameId: string) {
  return prisma.gameReminder.updateMany({
    where: { gameId, fired: false },
    data: { fired: true },
  });
}

export async function listPendingReminders(gameId: string) {
  return prisma.gameReminder.findMany({
    where: { gameId, fired: false },
    orderBy: { fireAt: "asc" },
  });
}

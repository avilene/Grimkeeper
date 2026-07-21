import { prisma } from "./client.js";

export type CreateGameWhisperInput = {
  gameId: string;
  threadId: string;
  name: string;
  neighbor: boolean;
  creatorDiscordId: string;
  targetDiscordId: string;
};

export async function createGameWhisper(input: CreateGameWhisperInput) {
  return prisma.gameWhisper.create({
    data: {
      gameId: input.gameId,
      threadId: input.threadId,
      name: input.name,
      neighbor: input.neighbor,
      creatorDiscordId: input.creatorDiscordId,
      targetDiscordId: input.targetDiscordId,
    },
  });
}

export async function listGameWhispers(gameId: string) {
  return prisma.gameWhisper.findMany({
    where: { gameId },
    orderBy: { createdAt: "asc" },
  });
}

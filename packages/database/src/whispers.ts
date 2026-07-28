import { prisma } from "./client.js";

export type CreateGameWhisperInput = {
  gameId: string;
  threadId: string;
  name: string;
  neighbor: boolean;
  creatorDiscordId: string;
  targetDiscordId: string;
  participantDiscordIds: string[];
};

/** Stable key for an unordered set of Discord user ids. */
export function whisperParticipantKey(discordUserIds: string[]): string {
  return [...new Set(discordUserIds)].sort().join(",");
}

export async function createGameWhisper(input: CreateGameWhisperInput) {
  return prisma.gameWhisper.create({
    data: {
      gameId: input.gameId,
      threadId: input.threadId,
      name: input.name,
      neighbor: input.neighbor,
      creatorDiscordId: input.creatorDiscordId,
      targetDiscordId: input.targetDiscordId,
      participantKey: whisperParticipantKey(input.participantDiscordIds),
    },
  });
}

export async function listGameWhispers(gameId: string) {
  return prisma.gameWhisper.findMany({
    where: { gameId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Rewrite Discord ids on whisper rows where `oldDiscordUserId` is a participant.
 * Returns thread ids that need Discord membership updates.
 */
export async function substituteDiscordIdInGameWhispers(
  gameId: string,
  oldDiscordUserId: string,
  newDiscordUserId: string,
): Promise<{ threadIds: string[]; updated: number }> {
  if (oldDiscordUserId === newDiscordUserId) {
    return { threadIds: [], updated: 0 };
  }

  const whispers = await listGameWhispers(gameId);
  const threadIds: string[] = [];
  let updated = 0;

  for (const whisper of whispers) {
    const participants = whisper.participantKey
      ? whisper.participantKey.split(",").filter(Boolean)
      : [whisper.creatorDiscordId, whisper.targetDiscordId].filter(Boolean);

    const involvesOld =
      participants.includes(oldDiscordUserId) ||
      whisper.creatorDiscordId === oldDiscordUserId ||
      whisper.targetDiscordId === oldDiscordUserId;
    if (!involvesOld) continue;

    const nextParticipants = [
      ...new Set(
        participants.map((id) => (id === oldDiscordUserId ? newDiscordUserId : id)),
      ),
    ];
    const creatorDiscordId =
      whisper.creatorDiscordId === oldDiscordUserId
        ? newDiscordUserId
        : whisper.creatorDiscordId;
    const targetDiscordId =
      whisper.targetDiscordId === oldDiscordUserId
        ? newDiscordUserId
        : whisper.targetDiscordId;

    await prisma.gameWhisper.update({
      where: { id: whisper.id },
      data: {
        creatorDiscordId,
        targetDiscordId,
        participantKey: whisperParticipantKey(nextParticipants),
      },
    });
    threadIds.push(whisper.threadId);
    updated += 1;
  }

  return { threadIds, updated };
}

/** Most recent whisper for this exact participant set. */
export async function findGameWhisperByParticipants(
  gameId: string,
  participantDiscordIds: string[],
) {
  const key = whisperParticipantKey(participantDiscordIds);
  if (!key) return null;

  const byKey = await prisma.gameWhisper.findFirst({
    where: { gameId, participantKey: key },
    orderBy: { createdAt: "desc" },
  });
  if (byKey) return byKey;

  // Legacy pair rows (before participantKey): match unordered creator/target.
  if (participantDiscordIds.length !== 2) return null;
  const [a, b] = participantDiscordIds;
  if (!a || !b) return null;
  return prisma.gameWhisper.findFirst({
    where: {
      gameId,
      OR: [
        { creatorDiscordId: a, targetDiscordId: b },
        { creatorDiscordId: b, targetDiscordId: a },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** @deprecated Prefer findGameWhisperByParticipants */
export async function findGameWhisperBetweenPlayers(
  gameId: string,
  discordUserIdA: string,
  discordUserIdB: string,
) {
  return findGameWhisperByParticipants(gameId, [discordUserIdA, discordUserIdB]);
}

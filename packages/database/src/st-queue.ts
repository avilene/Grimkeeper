import { prisma } from "./client.js";

export type StQueueMemberRole = "co_st" | "player";
export type StQueueEntryStatus = "open" | "closed";

export type StQueueEntryWithMembers = Awaited<
  ReturnType<typeof listOpenQueueEntries>
>[number];

const entryInclude = {
  members: { orderBy: { createdAt: "asc" as const } },
} as const;

export function parseScriptImageUrls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function serializeScriptImageUrls(urls: string[]): string {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  return JSON.stringify(unique.slice(0, 20));
}

export async function getQueueBoardByGuild(guildId: string) {
  return prisma.stQueueBoard.findUnique({ where: { guildId } });
}

export async function getQueueBoardByThread(threadId: string) {
  return prisma.stQueueBoard.findFirst({ where: { threadId } });
}

export async function listQueueBoards() {
  return prisma.stQueueBoard.findMany({ orderBy: { updatedAt: "desc" } });
}

/**
 * Resolve the ST queue board thread for a guild: DB board first, then
 * `ST_QUEUE_THREAD_ID` env fallback (legacy single-guild bootstrap).
 */
export async function resolveQueueThreadId(guildId: string): Promise<string | null> {
  const board = await getQueueBoardByGuild(guildId);
  const fromDb = board?.threadId?.trim();
  if (fromDb) return fromDb;

  const fromEnv = process.env.ST_QUEUE_THREAD_ID?.trim();
  return fromEnv || null;
}

export async function ensureQueueBoard(guildId: string, threadId: string) {
  const existing = await getQueueBoardByGuild(guildId);
  if (existing) {
    if (existing.threadId !== threadId) {
      return prisma.stQueueBoard.update({
        where: { id: existing.id },
        data: { threadId, panelMessageId: null },
      });
    }
    return existing;
  }
  return prisma.stQueueBoard.create({
    data: { guildId, threadId },
  });
}

export async function setQueuePanelMessageId(boardId: string, panelMessageId: string | null) {
  return prisma.stQueueBoard.update({
    where: { id: boardId },
    data: { panelMessageId },
  });
}

export async function listOpenQueueEntries(guildId: string) {
  return prisma.stQueueEntry.findMany({
    where: { guildId, status: "open" },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: entryInclude,
  });
}

export async function getQueueEntryById(entryId: string) {
  return prisma.stQueueEntry.findUnique({
    where: { id: entryId },
    include: entryInclude,
  });
}

export async function findOpenEntryForOwner(guildId: string, ownerDiscordId: string) {
  return prisma.stQueueEntry.findFirst({
    where: { guildId, ownerDiscordId, status: "open" },
    include: entryInclude,
  });
}

async function nextQueuePosition(boardId: string): Promise<number> {
  const last = await prisma.stQueueEntry.findFirst({
    where: { boardId, status: "open" },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? 0) + 1;
}

export async function createQueueEntry(input: {
  boardId: string;
  guildId: string;
  ownerDiscordId: string;
  scriptName: string;
  scriptLink?: string;
  description?: string;
  scriptImageUrls?: string[];
}) {
  const position = await nextQueuePosition(input.boardId);
  return prisma.stQueueEntry.create({
    data: {
      boardId: input.boardId,
      guildId: input.guildId,
      ownerDiscordId: input.ownerDiscordId,
      scriptName: input.scriptName.trim().slice(0, 100) || "Untitled script",
      scriptLink: (input.scriptLink ?? "").trim().slice(0, 500),
      description: (input.description ?? "").trim().slice(0, 1800),
      scriptImageUrls: serializeScriptImageUrls(input.scriptImageUrls ?? []),
      status: "open",
      position,
    },
    include: entryInclude,
  });
}

export async function updateQueueEntry(
  entryId: string,
  data: {
    scriptName?: string;
    scriptLink?: string;
    description?: string;
    scriptImageUrls?: string[];
    status?: StQueueEntryStatus;
  },
) {
  return prisma.stQueueEntry.update({
    where: { id: entryId },
    data: {
      ...(data.scriptName !== undefined
        ? { scriptName: data.scriptName.trim().slice(0, 100) || "Untitled script" }
        : {}),
      ...(data.scriptLink !== undefined
        ? { scriptLink: data.scriptLink.trim().slice(0, 500) }
        : {}),
      ...(data.description !== undefined
        ? { description: data.description.trim().slice(0, 1800) }
        : {}),
      ...(data.scriptImageUrls !== undefined
        ? { scriptImageUrls: serializeScriptImageUrls(data.scriptImageUrls) }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
    include: entryInclude,
  });
}

export async function appendQueueEntryImages(entryId: string, urls: string[]) {
  const entry = await prisma.stQueueEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const merged = [...parseScriptImageUrls(entry.scriptImageUrls), ...urls];
  return updateQueueEntry(entryId, { scriptImageUrls: merged });
}

export async function closeQueueEntry(entryId: string) {
  return updateQueueEntry(entryId, { status: "closed" });
}

export async function addQueueMember(
  entryId: string,
  discordUserId: string,
  role: StQueueMemberRole,
) {
  return prisma.stQueueMember.upsert({
    where: {
      entryId_discordUserId_role: { entryId, discordUserId, role },
    },
    create: { entryId, discordUserId, role },
    update: {},
  });
}

export async function removeQueueMember(
  entryId: string,
  discordUserId: string,
  role?: StQueueMemberRole,
) {
  if (role) {
    await prisma.stQueueMember.deleteMany({
      where: { entryId, discordUserId, role },
    });
    return;
  }
  await prisma.stQueueMember.deleteMany({
    where: { entryId, discordUserId },
  });
}

export async function removeQueueMemberSelf(entryId: string, discordUserId: string) {
  await prisma.stQueueMember.deleteMany({
    where: { entryId, discordUserId },
  });
}

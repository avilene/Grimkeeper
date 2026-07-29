import { prisma } from "./client.js";

export async function getGuildSettings(guildId: string) {
  return prisma.guildSettings.findUnique({ where: { guildId } });
}

export async function listGuildSettings() {
  return prisma.guildSettings.findMany({ orderBy: { guildId: "asc" } });
}

export async function upsertGuildSettings(
  guildId: string,
  data: { archiveCategoryId?: string | null },
) {
  const archiveCategoryId =
    data.archiveCategoryId === undefined
      ? undefined
      : data.archiveCategoryId?.trim() || null;

  return prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      guildId,
      archiveCategoryId: archiveCategoryId ?? null,
    },
    update: {
      ...(archiveCategoryId !== undefined ? { archiveCategoryId } : {}),
    },
  });
}

/**
 * Guild archive category: DB row first, then ARCHIVE_CATEGORY_ID env fallback.
 */
export async function resolveArchiveCategoryId(guildId: string): Promise<string | null> {
  const settings = await getGuildSettings(guildId);
  const fromDb = settings?.archiveCategoryId?.trim();
  if (fromDb) return fromDb;

  const fromEnv = process.env.ARCHIVE_CATEGORY_ID?.trim();
  return fromEnv || null;
}

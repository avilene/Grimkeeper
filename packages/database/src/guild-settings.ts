import { prisma } from "./client.js";

export type GuildSettingsRoleFields = {
  archiveCategoryId?: string | null;
  allowedRoleIds?: string | null;
  adminRoleIds?: string | null;
  reminderRoleIds?: string | null;
  reminderPingRoleId?: string | null;
};

/** Parse a comma-separated Discord snowflake list (env / GuildSettings CSV). */
export function parseIdList(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** Serialize role/user IDs as a stable CSV (sorted for stable diffs). */
export function serializeIdList(ids: Iterable<string>): string {
  return [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].sort().join(",");
}

function normalizeOptionalId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() || null;
  return trimmed;
}

/** Normalize CSV: undefined = leave alone; null = clear to env fallback; "" = empty list. */
function normalizeOptionalCsv(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value.trim() === "") return "";
  return serializeIdList(parseIdList(value));
}

export async function getGuildSettings(guildId: string) {
  return prisma.guildSettings.findUnique({ where: { guildId } });
}

export async function listGuildSettings() {
  return prisma.guildSettings.findMany({ orderBy: { guildId: "asc" } });
}

/** Ensure a GuildSettings row exists (all role fields null → env fallback). */
export async function ensureGuildSettings(guildId: string) {
  const existing = await getGuildSettings(guildId);
  if (existing) return existing;
  return prisma.guildSettings.create({
    data: { guildId },
  });
}

export async function upsertGuildSettings(guildId: string, data: GuildSettingsRoleFields) {
  const archiveCategoryId = normalizeOptionalId(data.archiveCategoryId);
  const allowedRoleIds = normalizeOptionalCsv(data.allowedRoleIds);
  const adminRoleIds = normalizeOptionalCsv(data.adminRoleIds);
  const reminderRoleIds = normalizeOptionalCsv(data.reminderRoleIds);
  const reminderPingRoleId = normalizeOptionalId(data.reminderPingRoleId);

  const create = {
    guildId,
    archiveCategoryId: archiveCategoryId ?? null,
    allowedRoleIds: allowedRoleIds ?? null,
    adminRoleIds: adminRoleIds ?? null,
    reminderRoleIds: reminderRoleIds ?? null,
    reminderPingRoleId: reminderPingRoleId ?? null,
  };

  const update: Record<string, string | null> = {};
  if (archiveCategoryId !== undefined) update.archiveCategoryId = archiveCategoryId;
  if (allowedRoleIds !== undefined) update.allowedRoleIds = allowedRoleIds;
  if (adminRoleIds !== undefined) update.adminRoleIds = adminRoleIds;
  if (reminderRoleIds !== undefined) update.reminderRoleIds = reminderRoleIds;
  if (reminderPingRoleId !== undefined) update.reminderPingRoleId = reminderPingRoleId;

  return prisma.guildSettings.upsert({
    where: { guildId },
    create,
    update,
  });
}

/**
 * Append role IDs to a CSV field (creates the guild row if needed).
 * Pass `field` + role ids to add; returns the updated settings row.
 */
export async function addGuildSettingRoleIds(
  guildId: string,
  field: "allowedRoleIds" | "adminRoleIds" | "reminderRoleIds",
  roleIds: readonly string[],
) {
  const current = await ensureGuildSettings(guildId);
  const existing = parseIdList(current[field]);
  for (const id of roleIds) {
    const trimmed = id.trim();
    if (trimmed) existing.add(trimmed);
  }
  return upsertGuildSettings(guildId, {
    [field]: serializeIdList(existing),
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

import { prisma } from "./client.js";

export async function getPlayerAlias(
  guildId: string,
  discordUserId: string,
): Promise<string | null> {
  const row = await prisma.playerAlias.findUnique({
    where: { guildId_discordUserId: { guildId, discordUserId } },
    select: { alias: true },
  });
  return row?.alias ?? null;
}

export async function upsertPlayerAlias(
  guildId: string,
  discordUserId: string,
  alias: string,
): Promise<string> {
  const trimmed = alias.trim();
  const row = await prisma.playerAlias.upsert({
    where: { guildId_discordUserId: { guildId, discordUserId } },
    create: { guildId, discordUserId, alias: trimmed },
    update: { alias: trimmed },
    select: { alias: true },
  });
  return row.alias;
}

/** Resolve stored alias, or null if unset (caller supplies default). */
export async function resolvePlayerAlias(
  guildId: string,
  discordUserId: string,
): Promise<string | null> {
  return getPlayerAlias(guildId, discordUserId);
}

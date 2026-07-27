import { cache } from "react";

import {
  listEngineStorytellerGameIds,
  listGamesWithStRole,
} from "@grimkeeper/database";

import { auth } from "@/lib/auth";
import { fetchGuildMemberRoleIds } from "@/lib/discord-member";
import { parseAdminIds } from "@/lib/env";

export type AccessProfile = {
  userId: string;
  name: string | null;
  /** Discord user is in ADMIN_IDS (full admin). */
  isAdmin: boolean;
  /** Game ids the user may view/edit as storyteller (non-admin). */
  storytellerGameIds: Set<string>;
  /** Admin or storyteller of at least one game. */
  canListGames: boolean;
};

export function isAdminUserId(discordUserId: string): boolean {
  const allowed = parseAdminIds(process.env.ADMIN_IDS);
  return Boolean(discordUserId) && allowed.has(discordUserId);
}

/**
 * Resolve games the user can access via Discord ST role (`Game.stRoleId`)
 * and/or engine storyteller ids.
 */
export async function resolveStorytellerGameIds(
  discordUserId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();

  const [engineIds, gamesWithRole] = await Promise.all([
    listEngineStorytellerGameIds(discordUserId),
    listGamesWithStRole(),
  ]);
  for (const gameId of engineIds) ids.add(gameId);

  if (gamesWithRole.length === 0) return ids;

  const byGuild = new Map<string, Array<{ id: string; stRoleId: string }>>();
  for (const game of gamesWithRole) {
    const list = byGuild.get(game.guildId) ?? [];
    list.push({ id: game.id, stRoleId: game.stRoleId });
    byGuild.set(game.guildId, list);
  }

  await Promise.all(
    [...byGuild.entries()].map(async ([guildId, games]) => {
      const roleIds = await fetchGuildMemberRoleIds(guildId, discordUserId);
      if (!roleIds || roleIds.size === 0) return;
      for (const game of games) {
        if (roleIds.has(game.stRoleId)) ids.add(game.id);
      }
    }),
  );

  return ids;
}

/** Cached per-request access profile for the signed-in Discord user. */
export const getAccessProfile = cache(async (): Promise<AccessProfile | null> => {
  const session = await auth();
  const userId = session?.user?.id?.trim() ?? "";
  if (!userId) return null;

  const isAdmin = isAdminUserId(userId);
  const storytellerGameIds = isAdmin
    ? new Set<string>()
    : await resolveStorytellerGameIds(userId);

  return {
    userId,
    name: session?.user?.name ?? null,
    isAdmin,
    storytellerGameIds,
    canListGames: isAdmin || storytellerGameIds.size > 0,
  };
});

export function homePathForAccess(access: AccessProfile): string {
  return access.canListGames ? "/games" : "/stats";
}

export function canViewGame(access: AccessProfile, gameId: string): boolean {
  return access.isAdmin || access.storytellerGameIds.has(gameId);
}

export function canEditGame(access: AccessProfile, gameId: string): boolean {
  return canViewGame(access, gameId);
}

import { getBotcRole } from "@grimkeeper/engine";

import { prisma } from "./client.js";
import { teamFromRoleId } from "./sync-projection.js";

export type CharacterStat = {
  roleId: string;
  name: string;
  count: number;
};

export type PlayerStats = {
  gamesPlayed: number;
  wins: number;
  losses: number;
  /** Null when no good/evil games with a winner to score. */
  winRate: number | null;
  goodGames: number;
  evilGames: number;
  travelerGames: number;
  unalignedGames: number;
  topCharacters: CharacterStat[];
};

export type PlayerStatRow = {
  roleId: string | null;
  team: string | null;
  winner: string;
};

export type PlayerRoleHistoryEntry = {
  gameId: string;
  guildId: string;
  channelId: string;
  roleId: string | null;
  roleName: string | null;
  team: string | null;
  winner: string;
  result: "win" | "loss" | "unscored";
  source: string | null;
  endedAt: Date | null;
  createdAt: Date;
};

export type GuildPlayerStats = {
  guildId: string;
  stats: PlayerStats;
};

export type PlayerStatsOverview = {
  overall: PlayerStats;
  byGuild: GuildPlayerStats[];
  history: PlayerRoleHistoryEntry[];
  /** Win rate when playing good (null if no scored good games). */
  goodWinRate: number | null;
  /** Win rate when playing evil (null if no scored evil games). */
  evilWinRate: number | null;
};

export function aggregatePlayerStats(rows: PlayerStatRow[]): PlayerStats {
  let wins = 0;
  let losses = 0;
  let goodGames = 0;
  let evilGames = 0;
  let travelerGames = 0;
  let unalignedGames = 0;
  const roleCounts = new Map<string, number>();

  for (const row of rows) {
    const team = row.team ?? teamFromRoleId(row.roleId);
    if (team === "good") goodGames += 1;
    else if (team === "evil") evilGames += 1;
    else if (team === "traveler") travelerGames += 1;
    else unalignedGames += 1;

    if (team === "good" || team === "evil") {
      if (team === row.winner) wins += 1;
      else losses += 1;
    }

    if (row.roleId) {
      roleCounts.set(row.roleId, (roleCounts.get(row.roleId) ?? 0) + 1);
    }
  }

  const scored = wins + losses;
  const topCharacters = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([roleId, count]) => ({
      roleId,
      name: getBotcRole(roleId)?.name ?? roleId,
      count,
    }));

  return {
    gamesPlayed: rows.length,
    wins,
    losses,
    winRate: scored === 0 ? null : wins / scored,
    goodGames,
    evilGames,
    travelerGames,
    unalignedGames,
    topCharacters,
  };
}

function winRateForTeam(rows: PlayerStatRow[], teamFilter: "good" | "evil"): number | null {
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    const team = row.team ?? teamFromRoleId(row.roleId);
    if (team !== teamFilter) continue;
    if (team === row.winner) wins += 1;
    else losses += 1;
  }
  const scored = wins + losses;
  return scored === 0 ? null : wins / scored;
}

function resultForSeat(
  team: string | null,
  roleId: string | null,
  winner: string,
): "win" | "loss" | "unscored" {
  const resolved = team ?? teamFromRoleId(roleId);
  if (resolved !== "good" && resolved !== "evil") return "unscored";
  return resolved === winner ? "win" : "loss";
}

/** Guild-scoped stats for ended games with a recorded winner. */
export async function getPlayerStats(
  guildId: string,
  discordUserId: string,
): Promise<PlayerStats> {
  const players = await prisma.player.findMany({
    where: {
      discordUserId,
      game: {
        guildId,
        phase: "ended",
        winner: { in: ["good", "evil"] },
      },
    },
    select: {
      roleId: true,
      team: true,
      game: { select: { winner: true } },
    },
  });

  return aggregatePlayerStats(
    players.map((player) => ({
      roleId: player.roleId,
      team: player.team,
      winner: player.game.winner!,
    })),
  );
}

/**
 * Cross-guild stats + role history for a Discord user (ended games with a winner).
 * Used by the admin panel player stats page.
 */
export async function getPlayerStatsOverview(
  discordUserId: string,
): Promise<PlayerStatsOverview> {
  const seats = await prisma.player.findMany({
    where: {
      discordUserId,
      game: {
        phase: "ended",
        winner: { in: ["good", "evil"] },
      },
    },
    select: {
      roleId: true,
      team: true,
      game: {
        select: {
          id: true,
          guildId: true,
          channelId: true,
          winner: true,
          source: true,
          endedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ game: { endedAt: "desc" } }, { game: { createdAt: "desc" } }],
  });

  const rows: PlayerStatRow[] = seats.map((seat) => ({
    roleId: seat.roleId,
    team: seat.team,
    winner: seat.game.winner!,
  }));

  const byGuildMap = new Map<string, PlayerStatRow[]>();
  for (const seat of seats) {
    const guildId = seat.game.guildId;
    const list = byGuildMap.get(guildId) ?? [];
    list.push({
      roleId: seat.roleId,
      team: seat.team,
      winner: seat.game.winner!,
    });
    byGuildMap.set(guildId, list);
  }

  const history: PlayerRoleHistoryEntry[] = seats.map((seat) => {
    const team = seat.team ?? teamFromRoleId(seat.roleId);
    const roleId = seat.roleId;
    return {
      gameId: seat.game.id,
      guildId: seat.game.guildId,
      channelId: seat.game.channelId,
      roleId,
      roleName: roleId ? (getBotcRole(roleId)?.name ?? roleId) : null,
      team,
      winner: seat.game.winner!,
      result: resultForSeat(seat.team, seat.roleId, seat.game.winner!),
      source: seat.game.source,
      endedAt: seat.game.endedAt,
      createdAt: seat.game.createdAt,
    };
  });

  const byGuild = [...byGuildMap.entries()]
    .map(([guildId, guildRows]) => ({
      guildId,
      stats: aggregatePlayerStats(guildRows),
    }))
    .sort((a, b) => b.stats.gamesPlayed - a.stats.gamesPlayed || a.guildId.localeCompare(b.guildId));

  return {
    overall: aggregatePlayerStats(rows),
    byGuild,
    history,
    goodWinRate: winRateForTeam(rows, "good"),
    evilWinRate: winRateForTeam(rows, "evil"),
  };
}

export type PlayerStatsListEntry = {
  discordUserId: string;
  displayName: string;
  gamesPlayed: number;
};

/**
 * Distinct Discord users with scored seats, for admin player-stats browsing.
 * Optional `search` matches display name or Discord user id (case-insensitive).
 */
export async function listPlayersForStats(options?: {
  search?: string;
}): Promise<PlayerStatsListEntry[]> {
  const seats = await prisma.player.findMany({
    where: {
      game: {
        phase: "ended",
        winner: { in: ["good", "evil"] },
      },
    },
    select: {
      discordUserId: true,
      displayName: true,
    },
  });

  const byUser = new Map<string, { nameCounts: Map<string, number>; gamesPlayed: number }>();
  for (const seat of seats) {
    const existing = byUser.get(seat.discordUserId);
    if (existing) {
      existing.gamesPlayed += 1;
      existing.nameCounts.set(
        seat.displayName,
        (existing.nameCounts.get(seat.displayName) ?? 0) + 1,
      );
    } else {
      byUser.set(seat.discordUserId, {
        gamesPlayed: 1,
        nameCounts: new Map([[seat.displayName, 1]]),
      });
    }
  }

  const aliases = await prisma.playerAlias.findMany({
    where: { discordUserId: { in: [...byUser.keys()] } },
    select: { discordUserId: true, alias: true },
  });
  const aliasByUser = new Map<string, string>();
  for (const row of aliases) {
    if (!aliasByUser.has(row.discordUserId)) {
      aliasByUser.set(row.discordUserId, row.alias);
    }
  }

  const query = options?.search?.trim().toLowerCase() ?? "";

  const entries: PlayerStatsListEntry[] = [];
  for (const [discordUserId, data] of byUser) {
    const preferredName =
      [...data.nameCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0] ?? discordUserId;
    const displayName = aliasByUser.get(discordUserId) ?? preferredName;

    if (
      query &&
      !displayName.toLowerCase().includes(query) &&
      !preferredName.toLowerCase().includes(query) &&
      !discordUserId.toLowerCase().includes(query)
    ) {
      continue;
    }

    entries.push({ discordUserId, displayName, gamesPlayed: data.gamesPlayed });
  }

  return entries.sort(
    (a, b) =>
      b.gamesPlayed - a.gamesPlayed || a.displayName.localeCompare(b.displayName),
  );
}

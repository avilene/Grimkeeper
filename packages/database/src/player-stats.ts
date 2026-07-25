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

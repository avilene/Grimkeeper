import { redirect } from "next/navigation";
import { storytellerIdsFromEvents, type StoredGameEvent } from "@grimkeeper/database";
import type { GameEvent } from "@grimkeeper/engine";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { GamesTable, type GameListRow } from "@/components/games-table";
import { fetchChannelName, fetchGuildMemberDisplayName } from "@/lib/discord-member";
import { getAccessProfile, homePathForAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";

export const metadata = { title: "Games" };

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const access = await getAccessProfile();
  if (!access) redirect("/login");
  if (!access.canListGames) redirect(homePathForAccess(access));

  const { show } = await searchParams;
  const showEnded = show === "ended" || show === "all";
  const flash = await consumeFlash();

  const games = await prisma.game.findMany({
    where: {
      ...(showEnded ? {} : { phase: { not: "ended" } }),
      ...(access.isAdmin
        ? {}
        : { id: { in: [...access.storytellerGameIds] } }),
    },
    orderBy: { createdAt: "desc" },
    take: access.isAdmin ? 50 : 100,
    include: {
      players: { orderBy: [{ seat: "asc" }, { displayName: "asc" }] },
    },
  });

  const gameIds = games.map((game) => game.id);
  const gameEvents = gameIds.length
    ? await prisma.gameEvent.findMany({
        where: { gameId: { in: gameIds } },
        orderBy: [{ gameId: "asc" }, { seq: "asc" }],
      })
    : [];
  const eventsByGame = new Map<string, StoredGameEvent[]>();
  for (const row of gameEvents) {
    const existing = eventsByGame.get(row.gameId) ?? [];
    existing.push(row);
    eventsByGame.set(row.gameId, existing);
  }

  const storytellerIdsByGame = new Map<string, string[]>();
  for (const game of games) {
    const rows = eventsByGame.get(game.id) ?? [];
    storytellerIdsByGame.set(
      game.id,
      rows.length
        ? storytellerIdsFromEvents(
            game.id,
            rows.map((row) => row.payload as unknown as GameEvent),
          )
        : [],
    );
  }

  const [channelNames, storytellerNames] = await Promise.all([
    Promise.all(
      games.map(async (game) => [game.id, await fetchChannelName(game.channelId)] as const),
    ),
    Promise.all(
      games.flatMap((game) =>
        (storytellerIdsByGame.get(game.id) ?? []).map(async (discordUserId) => [
          `${game.guildId}:${discordUserId}`,
          await fetchGuildMemberDisplayName(game.guildId, discordUserId),
        ] as const),
      ),
    ),
  ]);
  const channelNameByGameId = new Map(channelNames);
  const storytellerNameByGuildUser = new Map(storytellerNames);

  const rows: GameListRow[] = games.map((game) => {
    const storytellerIds = storytellerIdsByGame.get(game.id) ?? [];
    return {
      id: game.id,
      phase: game.phase,
      source: game.source,
      guildId: game.guildId,
      channelId: game.channelId,
      channelName: channelNameByGameId.get(game.id) ?? null,
      winner: game.winner,
      playerCount: game.players.length,
      playerNames: game.players.map((player) => player.displayName),
      storytellers: storytellerIds.map(
        (discordUserId) =>
          storytellerNameByGuildUser.get(`${game.guildId}:${discordUserId}`) ?? discordUserId,
      ),
      createdAt: game.createdAt.toISOString(),
      endedAt: game.endedAt?.toISOString() ?? null,
    };
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Games</h1>
      <FlashBanner message={flash} />
      {access.isAdmin ? (
        <WarnBanner>
          Active games by default. Edits write directly to the SQLite projection — they do{" "}
          <strong>not</strong> append engine events and can drift from Discord / event history.
        </WarnBanner>
      ) : (
        <WarnBanner>
          Showing games where you are a storyteller (engine ST or this game’s Discord ST role).
          Edits write to the projection only.
        </WarnBanner>
      )}
      <GamesTable rows={rows} showEnded={showEnded} canRecord={access.isAdmin} />
    </div>
  );
}

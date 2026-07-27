import Link from "next/link";
import { redirect } from "next/navigation";
import { storytellerIdsFromEvents, type StoredGameEvent } from "@grimkeeper/database";
import type { GameEvent } from "@grimkeeper/engine";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchChannelName, fetchGuildMemberDisplayName } from "@/lib/discord-member";
import { getAccessProfile, homePathForAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { shortId } from "@/lib/utils";

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
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <Link href="/games" className="text-primary hover:underline">
          Active only
        </Link>
        <Link href="/games?show=all" className="text-primary hover:underline">
          Include ended
        </Link>
        {access.isAdmin ? (
          <Link href="/games/record" className="text-primary hover:underline">
            Record completed game
          </Link>
        ) : null}
        <span>{games.length} shown</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Game</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Guild</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Storytellers</TableHead>
            <TableHead>#</TableHead>
            <TableHead>Players</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9}>No games found.</TableCell>
            </TableRow>
          ) : (
            games.map((game) => {
              const active = game.phase !== "ended";
              const storytellerIds = storytellerIdsByGame.get(game.id) ?? [];
              const primaryStorytellerId = storytellerIds[0] ?? null;
              const coStorytellerIds = storytellerIds.slice(1);
              const channelName = channelNameByGameId.get(game.id);
              const storytellerLabel = (discordUserId: string) =>
                storytellerNameByGuildUser.get(`${game.guildId}:${discordUserId}`) ?? discordUserId;
              return (
                <TableRow key={game.id}>
                  <TableCell>
                    <Link href={`/games/${game.id}`} className="font-mono text-primary hover:underline">
                      {shortId(game.id)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={active ? "success" : "muted"}>{game.phase}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {game.source === "stats_only" ? (
                      <Badge variant="muted">stats only</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{game.guildId}</TableCell>
                  <TableCell className="text-xs">
                    <div>{channelName ? `#${channelName}` : "—"}</div>
                    <div className="font-mono text-muted-foreground">{game.channelId}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {primaryStorytellerId ? (
                      <div>
                        <div>{storytellerLabel(primaryStorytellerId)}</div>
                        {coStorytellerIds.length > 0 ? (
                          <div className="text-muted-foreground">
                            Co-ST:{" "}
                            {coStorytellerIds.map((id) => storytellerLabel(id)).join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{game.players.length}</TableCell>
                  <TableCell className="text-xs">
                    {game.players.length === 0
                      ? "—"
                      : game.players.map((p) => (
                          <div key={p.id}>
                            {p.displayName}{" "}
                            <span className="font-mono text-muted-foreground">({p.discordUserId})</span>
                          </div>
                        ))}
                  </TableCell>
                  <TableCell className="text-xs">
                    <LocalTime value={game.createdAt} />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

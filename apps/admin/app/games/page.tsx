import Link from "next/link";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { shortId } from "@/lib/utils";

export const metadata = { title: "Games" };

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const showEnded = show === "ended" || show === "all";
  const flash = await consumeFlash();

  const games = await prisma.game.findMany({
    where: showEnded ? undefined : { phase: { not: "ended" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      players: { orderBy: [{ seat: "asc" }, { displayName: "asc" }] },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Games</h1>
      <FlashBanner message={flash} />
      <WarnBanner>
        Active games by default. Edits write directly to the SQLite projection — they do{" "}
        <strong>not</strong> append engine events and can drift from Discord / event history.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href="/games" className="text-primary hover:underline">
          Active only
        </Link>
        <Link href="/games?show=all" className="text-primary hover:underline">
          Include ended
        </Link>
        <span>{games.length} shown</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Game</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Guild</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>#</TableHead>
            <TableHead>Players</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7}>No games found.</TableCell>
            </TableRow>
          ) : (
            games.map((game) => {
              const active = game.phase !== "ended";
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
                  <TableCell className="font-mono text-xs">{game.guildId}</TableCell>
                  <TableCell className="font-mono text-xs">{game.channelId}</TableCell>
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
                  <TableCell className="text-xs">{game.createdAt.toISOString()}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

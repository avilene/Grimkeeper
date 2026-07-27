import Link from "next/link";
import { listPlayersForStats } from "@grimkeeper/database";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/session";
import { shortId } from "@/lib/utils";

export const metadata = { title: "Player stats" };

export default async function AdminPlayerStatsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const players = await listPlayersForStats({ search: search || undefined });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Player stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse scored game history for any Discord user with ended games.
        </p>
      </div>

      <form className="flex max-w-md gap-2" method="get">
        <Input
          name="q"
          defaultValue={search}
          placeholder="Search name or Discord ID"
          aria-label="Search players"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Players ({players.length}
          {search ? ` matching “${search}”` : ""})
        </h2>
        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {search ? "No players match that search." : "No scored seats yet."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Discord ID</TableHead>
                <TableHead>Games</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
                <TableRow key={player.discordUserId}>
                  <TableCell>
                    <Link
                      href={`/stats/${player.discordUserId}`}
                      className="text-primary hover:underline"
                    >
                      {player.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(player.discordUserId, 12)}
                  </TableCell>
                  <TableCell className="tabular-nums">{player.gamesPlayed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

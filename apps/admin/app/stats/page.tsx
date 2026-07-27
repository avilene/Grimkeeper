import { redirect } from "next/navigation";
import { getPlayerStatsOverview } from "@grimkeeper/database";

import { WarnBanner } from "@/components/banners";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAccessProfile } from "@/lib/access";
import { shortId } from "@/lib/utils";

export const metadata = { title: "My stats" };

function formatWinRate(rate: number | null): string {
  if (rate == null) return "n/a";
  return `${(rate * 100).toFixed(1)}%`;
}

function resultBadge(result: "win" | "loss" | "unscored") {
  if (result === "win") return <Badge variant="success">win</Badge>;
  if (result === "loss") return <Badge variant="default">loss</Badge>;
  return <Badge variant="muted">unscored</Badge>;
}

export default async function PlayerStatsPage() {
  const access = await getAccessProfile();
  if (!access) redirect("/login");

  const overview = await getPlayerStatsOverview(access.userId);
  const { overall, byGuild, history, goodWinRate, evilWinRate } = overview;

  const alignmentBits = [
    overall.goodGames ? `${overall.goodGames} good` : null,
    overall.evilGames ? `${overall.evilGames} evil` : null,
    overall.travelerGames ? `${overall.travelerGames} traveler` : null,
    overall.unalignedGames ? `${overall.unalignedGames} unaligned` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ended games with a recorded winner across all guilds for{" "}
          <code className="font-mono">{access.userId}</code>
          {access.name ? ` (${access.name})` : ""}.
        </p>
      </div>

      <WarnBanner>
        Travelers and unaligned seats count in games played but not win rate. Stats-only recorded
        games are included when you were seated.
      </WarnBanner>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Games played</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{overall.gamesPlayed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Wins / losses</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {overall.wins} / {overall.losses}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Win rate</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatWinRate(overall.winRate)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Good / evil WR</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {formatWinRate(goodWinRate)} / {formatWinRate(evilWinRate)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alignment</CardTitle>
            <CardDescription>Seats by team across scored games</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {alignmentBits.length > 0 ? alignmentBits.join(" · ") : "No ended games yet."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most played roles</CardTitle>
            <CardDescription>Top characters by seat count</CardDescription>
          </CardHeader>
          <CardContent>
            {overall.topCharacters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No characters recorded.</p>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {overall.topCharacters.map((entry) => (
                  <li key={entry.roleId}>
                    {entry.name}{" "}
                    <span className="text-muted-foreground">×{entry.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {byGuild.length > 1 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">By guild</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guild</TableHead>
                <TableHead>Games</TableHead>
                <TableHead>W / L</TableHead>
                <TableHead>Win rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byGuild.map((row) => (
                <TableRow key={row.guildId}>
                  <TableCell className="font-mono text-xs">{row.guildId}</TableCell>
                  <TableCell>{row.stats.gamesPlayed}</TableCell>
                  <TableCell>
                    {row.stats.wins} / {row.stats.losses}
                  </TableCell>
                  <TableCell>{formatWinRate(row.stats.winRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Role history</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Game</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Winner</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Guild</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  No ended games with a winner found for your Discord ID.
                </TableCell>
              </TableRow>
            ) : (
              history.map((entry) => {
                const when = entry.endedAt ?? entry.createdAt;
                return (
                  <TableRow key={`${entry.gameId}-${entry.roleId ?? "none"}-${when.toISOString()}`}>
                    <TableCell className="whitespace-nowrap text-xs">
                      <LocalTime value={when} mode="date" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{shortId(entry.gameId)}</TableCell>
                    <TableCell>{entry.roleName ?? "—"}</TableCell>
                    <TableCell>{entry.team ?? "—"}</TableCell>
                    <TableCell>{entry.winner}</TableCell>
                    <TableCell>{resultBadge(entry.result)}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.guildId}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

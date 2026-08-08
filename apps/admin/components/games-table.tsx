"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Plus } from "lucide-react";

import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, shortId } from "@/lib/utils";

export type GameListRow = {
  id: string;
  phase: string;
  source: string | null;
  guildId: string;
  channelId: string;
  channelName: string | null;
  winner: string | null;
  playerCount: number;
  playerNames: string[];
  storytellers: string[];
  createdAt: string;
  endedAt: string | null;
};

function PlayerNames({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  return (
    <div className="max-w-[14rem]">
      <div className="truncate" title={names.join(", ")}>
        {shown.join(", ")}
        {rest > 0 ? `, +${rest}` : ""}
      </div>
    </div>
  );
}

export function GamesTable({
  rows,
  showEnded,
  canRecord,
}: {
  rows: GameListRow[];
  showEnded: boolean;
  canRecord: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setShowEnded(includeEnded: boolean) {
    startTransition(() => {
      const href = includeEnded ? `${pathname}?show=all` : pathname;
      router.push(href);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-ended"
              checked={showEnded}
              disabled={pending}
              onCheckedChange={setShowEnded}
            />
            <Label
              htmlFor="include-ended"
              className={cn("cursor-pointer text-sm font-normal", pending && "opacity-60")}
            >
              Include ended
            </Label>
          </div>
          <span className="text-sm text-muted-foreground">
            {rows.length} game{rows.length === 1 ? "" : "s"}
            {pending ? " · updating…" : ""}
          </span>
        </div>
        {canRecord ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/games/record">
              <Plus className="size-3.5" />
              Record game
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Storytellers</TableHead>
              <TableHead className="text-right">Players</TableHead>
              <TableHead>Roster</TableHead>
              {showEnded ? <TableHead>Winner</TableHead> : null}
              <TableHead>Created</TableHead>
              {showEnded ? <TableHead>Ended</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showEnded ? 9 : 7}
                  className="h-24 whitespace-normal text-center text-muted-foreground"
                >
                  {showEnded
                    ? "No games found."
                    : "No active games. Toggle Include ended to browse history."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((game) => {
                const active = game.phase !== "ended";
                return (
                  <TableRow key={game.id}>
                    <TableCell className="whitespace-normal">
                      <div className="space-y-1">
                        <Link
                          href={`/games/${game.id}`}
                          className="font-mono text-sm text-primary hover:underline"
                        >
                          {shortId(game.id)}
                        </Link>
                        {game.source === "stats_only" ? (
                          <Badge variant="muted">stats only</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={active ? "success" : "muted"}>{game.phase}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs">
                      <div className="font-medium">
                        {game.channelName ? `#${game.channelName}` : "—"}
                      </div>
                      <div className="font-mono text-muted-foreground" title={game.guildId}>
                        {game.channelId}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs">
                      {game.storytellers.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div>{game.storytellers[0]}</div>
                          {game.storytellers.length > 1 ? (
                            <div className="text-muted-foreground">
                              Co-ST: {game.storytellers.slice(1).join(", ")}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{game.playerCount}</TableCell>
                    <TableCell className="whitespace-normal text-xs">
                      <PlayerNames names={game.playerNames} />
                    </TableCell>
                    {showEnded ? (
                      <TableCell>
                        {game.winner ? (
                          <Badge variant={game.winner === "cancel" ? "muted" : "secondary"}>
                            {game.winner}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-xs">
                      <LocalTime value={game.createdAt} />
                    </TableCell>
                    {showEnded ? (
                      <TableCell className="text-xs">
                        {game.endedAt ? (
                          <LocalTime value={game.endedAt} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

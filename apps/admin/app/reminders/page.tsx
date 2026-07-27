import Link from "next/link";

import { LocalTime } from "@/components/local-time";
import { WarnBanner } from "@/components/banners";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { shortId } from "@/lib/utils";

export const metadata = { title: "Reminders" };

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAdmin();
  const { show } = await searchParams;
  const showFired = show === "fired" || show === "all";

  const reminders = await prisma.gameReminder.findMany({
    where: showFired ? undefined : { fired: false },
    orderBy: [{ fired: "asc" }, { fireAt: "asc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <Button asChild size="sm">
          <Link href="/reminders/new">New reminder</Link>
        </Button>
      </div>
      <WarnBanner>
        Reminder rows fire via the bot poller. Edits here write SQLite directly and do not append
        engine events.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href="/reminders" className="text-primary hover:underline">
          Pending only
        </Link>
        <Link href="/reminders?show=all" className="text-primary hover:underline">
          Include fired
        </Link>
        <span>{reminders.length} shown</span>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reminders.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fire at</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Guild</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Game</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reminders.map((reminder) => (
              <TableRow key={reminder.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  <Link
                    href={`/reminders/${reminder.id}`}
                    className="text-primary hover:underline"
                  >
                    <LocalTime value={reminder.fireAt} />
                  </Link>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{reminder.message}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(reminder.guildId, 10)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(reminder.channelId, 10)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {reminder.gameId ? (
                    <Link
                      href={`/games/${reminder.gameId}`}
                      className="text-primary hover:underline"
                    >
                      {shortId(reminder.gameId)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={reminder.fired ? "muted" : "default"}>
                    {reminder.fired ? "fired" : "pending"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

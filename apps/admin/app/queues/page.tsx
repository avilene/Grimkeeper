import Link from "next/link";

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
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { requireAdmin } from "@/lib/session";
import { shortId } from "@/lib/utils";

export const metadata = { title: "ST Queue" };

export default async function QueuesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAdmin();
  const { show } = await searchParams;
  const showAll = show === "all";
  const flash = await consumeFlash();

  const boards = await prisma.stQueueBoard.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      entries: {
        where: showAll ? undefined : { status: "open" },
        orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }],
        include: { members: true },
      },
    },
  });

  const entryCount = boards.reduce((sum, board) => sum + board.entries.length, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">ST Queue</h1>
      <FlashBanner message={flash} />
      <WarnBanner>
        ST queue boards and entries. Edits write directly to SQLite — run{" "}
        <code>/st queue refresh</code> in Discord to update the live panel.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href="/queues" className="text-primary hover:underline">
          Open only
        </Link>
        <Link href="/queues?show=all" className="text-primary hover:underline">
          Include closed
        </Link>
        <span>
          {boards.length} board{boards.length === 1 ? "" : "s"} · {entryCount} entr
          {entryCount === 1 ? "y" : "ies"}
        </span>
      </div>

      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No queue boards yet. Set <code>ST_QUEUE_THREAD_ID</code> and use{" "}
          <code>/st queue join</code>.
        </p>
      ) : (
        boards.map((board) => (
          <section key={board.id} className="space-y-3">
            <h2 className="text-lg font-semibold">
              Board <code>{shortId(board.id)}</code>
            </h2>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>
                Guild <code className="font-mono">{board.guildId}</code>
              </span>
              <span>
                Thread <code className="font-mono">{board.threadId}</code>
              </span>
              <span>
                Panel message{" "}
                <code className="font-mono">{board.panelMessageId ?? "—"}</code>
              </span>
              <span>
                {board.entries.length} entr{board.entries.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Script</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Co-ST / Players</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      No entries{showAll ? "" : " (open only)"}.
                    </TableCell>
                  </TableRow>
                ) : (
                  board.entries.map((entry) => {
                    const coSt = entry.members.filter((m) => m.role === "co_st").length;
                    const players = entry.members.filter((m) => m.role === "player").length;
                    const open = entry.status === "open";
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>{entry.position}</TableCell>
                        <TableCell>
                          <Link
                            href={`/queues/entries/${entry.id}`}
                            className="text-primary hover:underline"
                          >
                            {entry.scriptName}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{entry.ownerDiscordId}</TableCell>
                        <TableCell>
                          <Badge variant={open ? "success" : "muted"}>{entry.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {coSt} / {players}
                        </TableCell>
                        <TableCell className="text-xs">
                          <LocalTime value={entry.createdAt} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </section>
        ))
      )}
    </div>
  );
}

import Link from "next/link";

import { GuildSettingsForm } from "@/components/guild-settings-form";
import { WarnBanner } from "@/components/banners";
import { LocalTime } from "@/components/local-time";
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

export const metadata = { title: "Guild settings" };

export default async function GuildSettingsPage() {
  await requireAdmin();
  const rows = await prisma.guildSettings.findMany({
    orderBy: { guildId: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Guild settings</h1>
      <WarnBanner>
        Per-guild Discord configuration. Used by <code>/st do archive</code> to move town channels
        into the Archives category. Without a row here, the bot falls back to{" "}
        <code>ARCHIVE_CATEGORY_ID</code> in the environment.
      </WarnBanner>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Create</h2>
        <GuildSettingsForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All guilds ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guild settings yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guild</TableHead>
                <TableHead>Archives category</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.guildId}>
                  <TableCell>
                    <Link
                      href={`/guild-settings/${row.guildId}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {row.guildId}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.archiveCategoryId ? (
                      row.archiveCategoryId
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <LocalTime value={row.updatedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

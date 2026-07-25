import Link from "next/link";

import { AliasForm } from "@/components/alias-form";
import { WarnBanner } from "@/components/banners";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { shortId } from "@/lib/utils";

export const metadata = { title: "Aliases" };

export default async function AliasesPage() {
  const aliases = await prisma.playerAlias.findMany({
    orderBy: [{ guildId: "asc" }, { alias: "asc" }],
    take: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Aliases</h1>
      <WarnBanner>
        Guild-scoped display names used across games. Bot <code>/alias</code> writes the same table.
      </WarnBanner>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Create</h2>
        <AliasForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All aliases ({aliases.length})</h2>
        {aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No aliases yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Guild</TableHead>
                <TableHead>Discord user</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((row) => (
                <TableRow key={`${row.guildId}:${row.discordUserId}`}>
                  <TableCell>
                    <Link
                      href={`/aliases/${row.guildId}/${row.discordUserId}`}
                      className="text-primary hover:underline"
                    >
                      {row.alias}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{shortId(row.guildId, 10)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(row.discordUserId, 10)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.updatedAt.toISOString()}
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

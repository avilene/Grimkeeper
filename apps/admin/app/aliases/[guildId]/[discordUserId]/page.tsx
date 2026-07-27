import Link from "next/link";
import { notFound } from "next/navigation";

import { AliasForm } from "@/components/alias-form";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guildId: string; discordUserId: string }>;
}) {
  const { discordUserId } = await params;
  return { title: `Alias ${discordUserId.slice(0, 8)}` };
}

export default async function AliasDetailPage({
  params,
}: {
  params: Promise<{ guildId: string; discordUserId: string }>;
}) {
  await requireAdmin();
  const { guildId, discordUserId } = await params;
  const aliasRow = await prisma.playerAlias.findUnique({
    where: { guildId_discordUserId: { guildId, discordUserId } },
  });
  if (!aliasRow) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Edit alias</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/aliases">Back</Link>
        </Button>
      </div>
      <AliasForm aliasRow={aliasRow} />
    </div>
  );
}

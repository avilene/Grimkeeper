import Link from "next/link";

import { GuildSettingsForm } from "@/components/guild-settings-form";
import { prisma } from "@/lib/db";
import { redirectAdminNotFound } from "@/lib/not-found";
import { requireAdmin } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  return { title: `Guild ${guildId}` };
}

export default async function GuildSettingsDetailPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  await requireAdmin();
  const { guildId } = await params;
  const row = await prisma.guildSettings.findUnique({ where: { guildId } });
  if (!row) {
    await redirectAdminNotFound({
      guildId,
      reason: "missing_guild_settings",
      route: "/guild-settings/[guildId]",
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/guild-settings" className="text-sm text-primary hover:underline">
          ← Guild settings
        </Link>
        <h1 className="text-2xl font-bold">Guild settings</h1>
        <p className="font-mono text-sm text-muted-foreground">{row.guildId}</p>
      </div>
      <GuildSettingsForm
        row={{
          guildId: row.guildId,
          archiveCategoryId: row.archiveCategoryId,
        }}
      />
    </div>
  );
}

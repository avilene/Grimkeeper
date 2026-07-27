import Link from "next/link";
import { getPlayerStatsOverview } from "@grimkeeper/database";

import { PlayerStatsView } from "@/components/player-stats-view";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ discordUserId: string }>;
}) {
  const { discordUserId } = await params;
  return { title: `Stats · ${discordUserId}` };
}

export default async function AdminPlayerStatsPage({
  params,
}: {
  params: Promise<{ discordUserId: string }>;
}) {
  await requireAdmin();
  const { discordUserId } = await params;

  const [overview, latestSeat, alias] = await Promise.all([
    getPlayerStatsOverview(discordUserId),
    prisma.player.findFirst({
      where: { discordUserId },
      orderBy: { game: { createdAt: "desc" } },
      select: { displayName: true },
    }),
    prisma.playerAlias.findFirst({
      where: { discordUserId },
      orderBy: { updatedAt: "desc" },
      select: { alias: true },
    }),
  ]);

  const displayName = alias?.alias ?? latestSeat?.displayName ?? discordUserId;

  return (
    <div className="space-y-4">
      <Button asChild variant="secondary" size="sm">
        <Link href="/stats/players">← All players</Link>
      </Button>
      <PlayerStatsView
        title={`Stats — ${displayName}`}
        subtitle={
          <>
            Ended games with a recorded winner across all guilds for{" "}
            <code className="font-mono">{discordUserId}</code>
            {displayName !== discordUserId ? ` (${displayName})` : ""}.
          </>
        }
        overview={overview}
        emptyHistoryMessage="No ended games with a winner found for this Discord ID."
      />
    </div>
  );
}

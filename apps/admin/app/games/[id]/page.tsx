import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBotcEdition, listBotcRoles } from "@grimkeeper/engine";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { GameFieldsForm } from "@/components/game-fields-form";
import { PlayersTableForm } from "@/components/players-table-form";
import type { RoleOption } from "@/components/role-combobox";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { shortId } from "@/lib/utils";

const ACTIVE_PHASES = ["lobby", "setup", "night", "day"] as const;

function catalogRoleOptions(): RoleOption[] {
  return listBotcRoles()
    .map((role) => ({
      id: role.id,
      name: role.name,
      type: role.team,
      edition: formatBotcEdition(role.edition),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Game ${shortId(id)}` };
}

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flash = await consumeFlash();
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      players: { orderBy: [{ seat: "asc" }, { displayName: "asc" }] },
    },
  });
  if (!game) notFound();

  const roleOptions = catalogRoleOptions();
  const knownIds = new Set(roleOptions.map((role) => role.id));
  for (const player of game.players) {
    const roleId = player.roleId?.trim();
    if (!roleId || knownIds.has(roleId)) continue;
    roleOptions.push({ id: roleId, name: roleId, type: "custom", edition: "in game" });
    knownIds.add(roleId);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Game {shortId(game.id)}</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/games">Back</Link>
        </Button>
      </div>
      <FlashBanner message={flash} />
      <WarnBanner>
        Direct DB edits. Prefer bot commands when possible. Changing Discord IDs / thread IDs can
        break live Discord surfaces until they are recreated. Known phases:{" "}
        {ACTIVE_PHASES.map((p) => (
          <code key={p} className="mx-0.5">
            {p}
          </code>
        ))}
        , <code>ended</code>.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          ID <code>{game.id}</code>
        </span>
        <span>Created {game.createdAt.toISOString()}</span>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Game fields</h2>
        <GameFieldsForm gameId={game.id} game={game} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Players ({game.players.length})</h2>
        <PlayersTableForm gameId={game.id} players={game.players} roles={roleOptions} />
      </section>
    </div>
  );
}

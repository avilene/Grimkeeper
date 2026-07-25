import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBotcEdition, listBotcRoles } from "@grimkeeper/engine";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { DeleteGameForm } from "@/components/delete-game-form";
import { GameDaysSection } from "@/components/game-days-section";
import { GameFieldsForm } from "@/components/game-fields-form";
import { GameRemindersSection } from "@/components/game-reminders-section";
import { NominationsSection } from "@/components/nominations-section";
import { PlayersTableForm } from "@/components/players-table-form";
import type { RoleOption } from "@/components/role-combobox";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { shortId } from "@/lib/utils";

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
      gameDays: {
        orderBy: { dayNumber: "asc" },
        include: {
          nominations: {
            orderBy: { order: "asc" },
            include: { votes: { orderBy: { id: "asc" } } },
          },
        },
      },
      reminders: { orderBy: { fireAt: "asc" }, take: 50 },
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

  const nominations = game.gameDays
    .flatMap((day) =>
      day.nominations.map((nomination) => ({
        id: nomination.id,
        gameDayId: day.id,
        dayNumber: day.dayNumber,
        nominatorId: nomination.nominatorId,
        nomineeId: nomination.nomineeId,
        accusation: nomination.accusation,
        defense: nomination.defense,
        order: nomination.order,
        status: nomination.status,
        votes: nomination.votes,
      })),
    )
    .sort((a, b) => a.dayNumber - b.dayNumber || a.order - b.order || a.id.localeCompare(b.id));

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
        break live Discord surfaces until they are recreated. Phase is a select; winner applies when
        phase is <code>ended</code>.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          ID <code>{game.id}</code>
        </span>
        <span>Created {game.createdAt.toISOString()}</span>
        {game.winner ? <span>Winner {game.winner}</span> : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Game fields</h2>
        <GameFieldsForm gameId={game.id} game={game} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Players ({game.players.length})</h2>
        <PlayersTableForm gameId={game.id} players={game.players} roles={roleOptions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Days ({game.gameDays.length})</h2>
        <GameDaysSection gameId={game.id} days={game.gameDays} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nominations & votes ({nominations.length})</h2>
        <NominationsSection
          gameId={game.id}
          players={game.players}
          days={game.gameDays.map((day) => ({ id: day.id, dayNumber: day.dayNumber }))}
          nominations={nominations}
          discordRefreshPendingSince={game.discordNomsRefreshRequestedAt}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Reminders ({game.reminders.length})</h2>
        <GameRemindersSection gameId={game.id} reminders={game.reminders} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
        <DeleteGameForm gameId={game.id} />
      </section>
    </div>
  );
}

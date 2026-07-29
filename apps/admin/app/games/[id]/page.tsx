import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getGameEvents,
  isStatsOnlyGame,
  storytellerIdsFromEvents,
} from "@grimkeeper/database";
import {
  formatBotcEdition,
  listBotcRoles,
  GameEngine,
  defaultBuffetConfig,
  type GameEvent,
} from "@grimkeeper/engine";

import { FlashBanner, WarnBanner } from "@/components/banners";
import { BuffetConfigForm, type BuffetRole } from "@/components/buffet-config-form";
import { DeleteGameForm } from "@/components/delete-game-form";
import { GameDaysSection } from "@/components/game-days-section";
import { GameFieldsForm } from "@/components/game-fields-form";
import { LocalTime } from "@/components/local-time";
import { GameRemindersSection } from "@/components/game-reminders-section";
import { NominationsSection } from "@/components/nominations-section";
import { PlayersTableForm } from "@/components/players-table-form";
import type { RoleOption } from "@/components/role-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canViewGame, getAccessProfile, homePathForAccess } from "@/lib/access";
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
  const access = await getAccessProfile();
  if (!access) redirect("/login");
  if (!canViewGame(access, id)) redirect(homePathForAccess(access));

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

  const statsOnly = isStatsOnlyGame(game.source);
  const storedEvents = await getGameEvents(game.id);
  const engineEvents = storedEvents.map((row) => row.payload as unknown as GameEvent);
  const storytellerIds =
    engineEvents.length > 0 ? storytellerIdsFromEvents(game.id, engineEvents) : [];
  const primaryStorytellerId = storytellerIds[0] ?? null;
  const coStorytellerIds = storytellerIds.slice(1);

  const roleOptions = catalogRoleOptions();
  const knownIds = new Set(roleOptions.map((role) => role.id));
  for (const player of game.players) {
    const roleId = player.roleId?.trim();
    if (!roleId || knownIds.has(roleId)) continue;
    roleOptions.push({ id: roleId, name: roleId, type: "custom", edition: "in game" });
    knownIds.add(roleId);
  }

  // Buffet draft state
  const buffetEngine = new GameEngine(game.id);
  for (const ev of engineEvents) {
    buffetEngine.apply(ev);
  }
  const buffetState = buffetEngine.getState().buffetDraft;
  const buffetConfig = buffetState?.config ?? defaultBuffetConfig();
  const seatedPlayerCount = game.players.filter((p) => p.seat !== null).length;
  const buffetRoles: BuffetRole[] = listBotcRoles().map((r) => ({
    id: r.id,
    name: r.name,
    team: r.team as BuffetRole["team"],
    edition: formatBotcEdition(r.edition) ?? r.edition ?? "",
  }));

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
        voteDeadlineAt: nomination.voteDeadlineAt?.toISOString() ?? null,
        votes: nomination.votes.map((vote) => ({
          id: vote.id,
          nominationId: vote.nominationId,
          voterId: vote.voterId,
          choice: vote.choice,
          reason: vote.reason,
          privateChoice: vote.privateChoice,
          privateReason: vote.privateReason,
        })),
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
      {statsOnly ? (
        <WarnBanner>
          Stats-only recorded game. No Discord threads or posts. Storytellers come from engine
          events (<code>GameCreated</code> / <code>StorytellerPromoted</code>).
        </WarnBanner>
      ) : (
        <WarnBanner>
          Direct DB edits. Prefer bot commands when possible. Changing Discord IDs / thread IDs can
          break live Discord surfaces until they are recreated. Phase is a select; winner applies
          when phase is <code>ended</code>.
        </WarnBanner>
      )}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          ID <code>{game.id}</code>
        </span>
        <span>
          Created <LocalTime value={game.createdAt} />
        </span>
        {game.startedAt ? (
          <span>
            Started <LocalTime value={game.startedAt} />
          </span>
        ) : null}
        {game.endedAt ? (
          <span>
            Ended <LocalTime value={game.endedAt} />
          </span>
        ) : null}
        {game.winner ? <span>Winner {game.winner}</span> : null}
        {statsOnly ? <Badge variant="muted">stats only</Badge> : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Storytellers</h2>
        {storytellerIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No storyteller events on this game (engine history empty or missing{" "}
            <code>GameCreated</code>).
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            <li>
              Primary ST{" "}
              <code className="font-mono">{primaryStorytellerId}</code>
            </li>
            {coStorytellerIds.map((stId) => (
              <li key={stId}>
                Co-ST <code className="font-mono">{stId}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          discordPushDisabled={statsOnly}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Reminders ({game.reminders.length})</h2>
        <GameRemindersSection gameId={game.id} reminders={game.reminders} />
      </section>

      {access.isAdmin ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
          <DeleteGameForm gameId={game.id} />
        </section>
      ) : null}

      {game.phase !== "ended" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" id="sushi-buffet-draft">Sushi Buffet Draft</h2>
          <p className="text-sm text-muted-foreground">
            Configure the role pool for a Sushi Buffet draft. All roles are enabled by default.
            Uncheck roles to remove them from the pool. Once configured, run{" "}
            <code>/st do buffet-start</code> in Discord to begin the draft.
          </p>
          {buffetState?.status === "active" ? (
            <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300">
              Draft in progress — {buffetState.currentIndex}/{buffetState.draftOrder.length} players have picked.
              Use <code>/st do buffet-status</code> in Discord for details or{" "}
              <code>/st do buffet-cancel</code> to cancel.
            </div>
          ) : buffetState?.status === "complete" ? (
            <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300">
              Draft complete — all players have picked their roles.
            </div>
          ) : null}
          <BuffetConfigForm
            gameId={game.id}
            roles={buffetRoles}
            initialEnabledIds={buffetConfig.enabledRoleIds}
            initialRecycle={buffetConfig.recycleUnchosen}
            playerCount={seatedPlayerCount}
            draftStatus={buffetState?.status ?? "idle"}
          />
        </section>
      ) : null}
    </div>
  );
}

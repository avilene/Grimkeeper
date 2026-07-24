import Link from "next/link";
import { notFound } from "next/navigation";

import { saveGame, savePlayer } from "@/actions/games";
import { FlashBanner, WarnBanner } from "@/components/banners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { shortId } from "@/lib/utils";

const ACTIVE_PHASES = ["lobby", "setup", "night", "day"] as const;

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} />
    </div>
  );
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Game {shortId(game.id)}</h1>
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
        <form action={saveGame.bind(null, game.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 rounded-md border border-border bg-card p-4">
          <Field name="phase" label="Phase" defaultValue={game.phase} />
          <Field name="dayNumber" label="Day number" type="number" defaultValue={game.dayNumber} />
          <Field name="nightNumber" label="Night number" type="number" defaultValue={game.nightNumber} />
          <Field name="guildId" label="Guild ID" defaultValue={game.guildId} />
          <Field name="channelId" label="Town channel ID" defaultValue={game.channelId} />
          <Field name="stRoleId" label="ST role ID" defaultValue={game.stRoleId} />
          <Field name="playerRoleId" label="Player role ID" defaultValue={game.playerRoleId} />
          <Field name="kibRoleId" label="Kib role ID" defaultValue={game.kibRoleId} />
          <Field name="kibThreadId" label="Kib thread ID" defaultValue={game.kibThreadId} />
          <Field name="logThreadId" label="Log thread ID" defaultValue={game.logThreadId} />
          <Field name="votingThreadId" label="Voting thread ID" defaultValue={game.votingThreadId} />
          <Field
            name="whisperDeclThreadId"
            label="Whisper declarations thread"
            defaultValue={game.whisperDeclThreadId}
          />
          <Field name="claimsThreadId" label="Claims thread ID" defaultValue={game.claimsThreadId} />
          <Field name="rulesThreadId" label="Rules thread ID" defaultValue={game.rulesThreadId} />
          <div className="col-span-full flex gap-2">
            <Button type="submit">Save game</Button>
            <Button asChild variant="secondary">
              <Link href="/games">Back</Link>
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Players ({game.players.length})</h2>
        {game.players.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players.</p>
        ) : (
          game.players.map((player) => (
            <div key={player.id} className="space-y-2">
              <h3 className="font-medium">
                {player.displayName}{" "}
                <span className="font-mono text-sm text-muted-foreground">· {shortId(player.id)}</span>
              </h3>
              <form
                action={savePlayer.bind(null, game.id, player.id)}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 rounded-md border border-border bg-card p-4"
              >
                <Field name="displayName" label="Display name" defaultValue={player.displayName} />
                <Field name="discordUserId" label="Discord user ID" defaultValue={player.discordUserId} />
                <Field name="seat" label="Seat" type="number" defaultValue={player.seat} />
                <Field name="roleId" label="Role ID" defaultValue={player.roleId} />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    name="alive"
                    defaultChecked={player.alive}
                    className="size-4 rounded border-input"
                  />
                  Alive
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    name="ghostVoteUsed"
                    defaultChecked={player.ghostVoteUsed}
                    className="size-4 rounded border-input"
                  />
                  Ghost vote used
                </label>
                <div className="col-span-full">
                  <Button type="submit">Save player</Button>
                </div>
              </form>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

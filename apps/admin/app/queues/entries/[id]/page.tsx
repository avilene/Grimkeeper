import Link from "next/link";

import {
  addQueueMemberAction,
  closeQueueEntryAction,
  removeQueueMemberAction,
  saveQueueEntry,
} from "@/actions/queues";
import { FlashBanner, WarnBanner } from "@/components/banners";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getQueueEntryById, parseScriptImageUrls, prisma } from "@/lib/db";
import { consumeFlash } from "@/lib/flash";
import { redirectAdminNotFound } from "@/lib/not-found";
import { requireAdmin } from "@/lib/session";
import { shortId } from "@/lib/utils";

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
  const entry = await getQueueEntryById(id);
  return { title: entry ? `Queue · ${entry.scriptName}` : "Queue entry" };
}

export default async function QueueEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const flash = await consumeFlash();
  const entry = await getQueueEntryById(id);
  if (!entry) {
    await redirectAdminNotFound({
      entryId: id,
      reason: "missing_queue_entry",
      route: "/queues/entries/[id]",
    });
  }

  const board = await prisma.stQueueBoard.findUnique({ where: { id: entry.boardId } });
  const imageLines = parseScriptImageUrls(entry.scriptImageUrls).join("\n");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Queue · {entry.scriptName}</h1>
      <FlashBanner message={flash} />
      <WarnBanner>
        Direct DB edits. The Discord panel does <strong>not</strong> update automatically — run{" "}
        <code>/st queue refresh</code> after changes. Do not invent board/thread/panel IDs here.
      </WarnBanner>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          ID <code>{entry.id}</code>
        </span>
        <span>
          Board <code>{shortId(entry.boardId)}</code>
        </span>
        <span>
          Guild <code className="font-mono">{entry.guildId}</code>
        </span>
        <span>
          Thread <code className="font-mono">{board?.threadId ?? "—"}</code>
        </span>
        <Link href="/queues" className="text-primary hover:underline">
          ← Queue list
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Entry fields</h2>
        <form
          action={saveQueueEntry.bind(null, entry.id)}
          className="grid gap-3 sm:grid-cols-2 rounded-md border border-border bg-card p-4"
        >
          <Field name="scriptName" label="Script name" defaultValue={entry.scriptName} />
          <Field name="scriptLink" label="Script link" defaultValue={entry.scriptLink} />
          <Field name="ownerDiscordId" label="Owner Discord ID" defaultValue={entry.ownerDiscordId} />
          <Field name="position" label="Position" type="number" defaultValue={entry.position} />
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={entry.status}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="open">open</option>
              <option value="closed">closed</option>
            </select>
          </div>
          <div className="col-span-full space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={entry.description} />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label htmlFor="scriptImageUrls">Script image URLs (one per line)</Label>
            <Textarea id="scriptImageUrls" name="scriptImageUrls" defaultValue={imageLines} />
          </div>
          <div className="col-span-full flex flex-wrap gap-2">
            <Button type="submit">Save entry</Button>
            {entry.status === "open" ? (
              <Button formAction={closeQueueEntryAction.bind(null, entry.id)} type="submit" variant="secondary">
                Close entry
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href="/queues">Back</Link>
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Members ({entry.members.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Discord user</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>No members.</TableCell>
              </TableRow>
            ) : (
              entry.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-mono text-xs">{member.discordUserId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <LocalTime value={member.createdAt} />
                  </TableCell>
                  <TableCell>
                    <form action={removeQueueMemberAction.bind(null, entry.id, member.id)}>
                      <Button type="submit" variant="secondary" size="sm">
                        Remove
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="space-y-2">
          <h3 className="font-medium">Add member</h3>
          <form
            action={addQueueMemberAction.bind(null, entry.id)}
            className="grid gap-3 sm:grid-cols-2 max-w-xl rounded-md border border-border bg-card p-4"
          >
            <Field name="discordUserId" label="Discord user ID" defaultValue="" />
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                defaultValue="player"
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="player">player</option>
                <option value="co_st">co_st</option>
              </select>
            </div>
            <div className="col-span-full">
              <Button type="submit">Add member</Button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

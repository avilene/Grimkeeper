"use client";

import { useActionState, useMemo, useState } from "react";

import {
  deleteNomination,
  deleteVote,
  saveNomination,
  saveVote,
  type SaveResult,
} from "@/actions/games";
import { RefreshNomsButton } from "@/components/refresh-noms-button";
import { SaveStatus, SubmitButton } from "@/components/save-form";
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
import { cn } from "@/lib/utils";

const STATUSES = ["open", "resolved_pass", "resolved_fail", "executed"] as const;
const CHOICES = ["yes", "no", "conditional"] as const;

const cellInputClass = cn(
  "h-8 min-w-[6rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

const selectClassName = cn(cellInputClass, "w-full");

const formSelectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

export type NominationPlayerOption = {
  id: string;
  displayName: string;
  seat: number | null;
};

export type EditableVote = {
  id: string;
  nominationId: string;
  voterId: string;
  choice: string | null;
  reason: string | null;
  privateChoice: string | null;
  privateReason: string | null;
};

export type EditableNomination = {
  id: string;
  gameDayId: string;
  dayNumber: number;
  nominatorId: string;
  nomineeId: string;
  accusation: string;
  defense: string | null;
  order: number;
  status: string;
  votes: EditableVote[];
};

function playerLabel(player: NominationPlayerOption): string {
  const seat = player.seat == null ? "?" : String(player.seat);
  return `#${seat} ${player.displayName}`;
}

function playerName(
  players: NominationPlayerOption[],
  playerId: string,
): string {
  const player = players.find((row) => row.id === playerId);
  return player ? playerLabel(player) : playerId.slice(0, 8);
}

function votesSummary(votes: EditableVote[]): string {
  if (votes.length === 0) return "no votes";
  let publicYes = 0;
  let privateYes = 0;
  for (const vote of votes) {
    if (vote.choice === "yes") publicYes += 1;
    if (vote.privateChoice === "yes") privateYes += 1;
  }
  return `${votes.length} voter${votes.length === 1 ? "" : "s"} · ${publicYes} pub yes · ${privateYes} priv yes`;
}

function PlayerSelect({
  name,
  label,
  players,
  defaultValue,
  form,
  compact,
  id,
}: {
  name: string;
  label: string | null;
  players: NominationPlayerOption[];
  defaultValue?: string;
  form?: string;
  compact?: boolean;
  id?: string;
}) {
  const selectId = id ?? name;
  return (
    <div className={compact ? undefined : "space-y-1.5"}>
      {label ? <Label htmlFor={selectId}>{label}</Label> : null}
      <select
        id={selectId}
        name={name}
        form={form}
        required
        defaultValue={defaultValue ?? ""}
        className={compact ? selectClassName : formSelectClassName}
        aria-label={label ?? undefined}
      >
        <option value="" disabled>
          Select player
        </option>
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {playerLabel(player)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChoiceSelect({
  name,
  label,
  defaultValue,
  form,
  id,
  allowEmpty,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  form?: string;
  id?: string;
  allowEmpty?: boolean;
}) {
  const selectId = id ?? name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      <select
        id={selectId}
        name={name}
        form={form}
        defaultValue={defaultValue ?? ""}
        className={formSelectClassName}
      >
        {allowEmpty ? <option value="">— none —</option> : null}
        {CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </div>
  );
}

function VoteTableRow({
  gameId,
  vote,
  players,
}: {
  gameId: string;
  vote: EditableVote;
  players: NominationPlayerOption[];
}) {
  const formId = `vote-save-${vote.id}`;
  const [saveResult, saveAction] = useActionState<SaveResult | null, FormData>(
    saveVote.bind(null, gameId, vote.id),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteVote.bind(null, gameId, vote.id),
    null,
  );

  return (
    <TableRow className="hover:bg-transparent align-top">
      <TableCell className="min-w-[9rem]">
        <form id={formId} action={saveAction} />
        <input form={formId} type="hidden" name="nominationId" value={vote.nominationId} />
        <PlayerSelect
          form={formId}
          name="voterId"
          label={null}
          players={players}
          defaultValue={vote.voterId}
          compact
          id={`voter-${vote.id}`}
        />
      </TableCell>
      <TableCell className="min-w-[7rem]">
        <select
          form={formId}
          name="choice"
          defaultValue={vote.choice ?? ""}
          className={selectClassName}
          aria-label="Public ballot"
        >
          <option value="">—</option>
          {CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="min-w-[10rem]">
        <Input
          form={formId}
          name="reason"
          defaultValue={vote.reason ?? ""}
          className={cn(cellInputClass, "min-w-[10rem]")}
          placeholder="Public conditional reason"
          aria-label="Public reason"
        />
      </TableCell>
      <TableCell className="min-w-[7rem]">
        <select
          form={formId}
          name="privateChoice"
          defaultValue={vote.privateChoice ?? ""}
          className={selectClassName}
          aria-label="Private ballot"
        >
          <option value="">—</option>
          {CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="min-w-[10rem]">
        <Input
          form={formId}
          name="privateReason"
          defaultValue={vote.privateReason ?? ""}
          className={cn(cellInputClass, "min-w-[10rem]")}
          placeholder="Private conditional reason"
          aria-label="Private reason"
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button type="submit" form={formId} size="sm">
              Save
            </Button>
            <form action={deleteAction}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(event) => {
                  if (!window.confirm("Delete this vote?")) event.preventDefault();
                }}
              >
                Delete
              </Button>
            </form>
          </div>
          <SaveStatus result={saveResult} />
          <SaveStatus result={deleteResult} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function NominationAccordionItem({
  gameId,
  nomination,
  players,
  days,
  open,
  onToggle,
}: {
  gameId: string;
  nomination: EditableNomination;
  players: NominationPlayerOption[];
  days: Array<{ id: string; dayNumber: number }>;
  open: boolean;
  onToggle: () => void;
}) {
  const formId = `nom-save-${nomination.id}`;
  const [saveResult, saveAction] = useActionState<SaveResult | null, FormData>(
    saveNomination.bind(null, gameId, nomination.id),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteNomination.bind(null, gameId, nomination.id),
    null,
  );
  const [voteCreateResult, voteCreateAction] = useActionState<SaveResult | null, FormData>(
    saveVote.bind(null, gameId, null),
    null,
  );

  const sortedVotes = useMemo(() => {
    const seatById = new Map(players.map((player) => [player.id, player.seat ?? 999]));
    return [...nomination.votes].sort(
      (a, b) => (seatById.get(a.voterId) ?? 999) - (seatById.get(b.voterId) ?? 999),
    );
  }, [nomination.votes, players]);

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="text-muted-foreground">#{nomination.order}</span>
            <span>Day {nomination.dayNumber}</span>
            <span className="text-muted-foreground">·</span>
            <span>{playerName(players, nomination.nominatorId)}</span>
            <span className="text-muted-foreground">→</span>
            <span>{playerName(players, nomination.nomineeId)}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {nomination.status}
            </span>
          </div>
          <p className="truncate text-sm text-muted-foreground">{nomination.accusation}</p>
          <p className="text-xs text-muted-foreground">{votesSummary(nomination.votes)}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <form id={formId} action={saveAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`order-${nomination.id}`}>Order</Label>
              <Input
                id={`order-${nomination.id}`}
                name="order"
                type="number"
                defaultValue={nomination.order}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`day-${nomination.id}`}>Game day</Label>
              <select
                id={`day-${nomination.id}`}
                name="gameDayId"
                defaultValue={nomination.gameDayId}
                className={formSelectClassName}
                required
              >
                {days.map((day) => (
                  <option key={day.id} value={day.id}>
                    Day {day.dayNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`status-${nomination.id}`}>Status</Label>
              <select
                id={`status-${nomination.id}`}
                name="status"
                defaultValue={nomination.status}
                className={formSelectClassName}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <PlayerSelect
              name="nominatorId"
              label="Nominator"
              players={players}
              defaultValue={nomination.nominatorId}
              id={`nominator-${nomination.id}`}
            />
            <PlayerSelect
              name="nomineeId"
              label="Nominee"
              players={players}
              defaultValue={nomination.nomineeId}
              id={`nominee-${nomination.id}`}
            />
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label htmlFor={`accusation-${nomination.id}`}>Accusation</Label>
              <Textarea
                id={`accusation-${nomination.id}`}
                name="accusation"
                defaultValue={nomination.accusation}
                rows={2}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label htmlFor={`defense-${nomination.id}`}>Defense</Label>
              <Textarea
                id={`defense-${nomination.id}`}
                name="defense"
                defaultValue={nomination.defense ?? ""}
                rows={2}
              />
            </div>
            <div className="col-span-full flex flex-wrap items-center gap-3">
              <SubmitButton>Save nomination</SubmitButton>
              <SaveStatus result={saveResult} />
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <form action={deleteAction}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(event) => {
                  if (!window.confirm("Delete this nomination and its votes?")) {
                    event.preventDefault();
                  }
                }}
              >
                Delete nomination
              </Button>
            </form>
            <SaveStatus result={deleteResult} />
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Votes</h4>
            {sortedVotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No votes yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Voter</TableHead>
                    <TableHead>Public</TableHead>
                    <TableHead>Public reason</TableHead>
                    <TableHead>Private</TableHead>
                    <TableHead>Private reason</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedVotes.map((vote) => (
                    <VoteTableRow
                      key={vote.id}
                      gameId={gameId}
                      vote={vote}
                      players={players}
                    />
                  ))}
                </TableBody>
              </Table>
            )}

            <form
              action={voteCreateAction}
              className="grid gap-3 rounded-md border border-dashed border-border bg-background/50 p-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <input type="hidden" name="nominationId" value={nomination.id} />
              <h5 className="col-span-full text-sm font-medium">Add vote</h5>
              <PlayerSelect name="voterId" label="Voter" players={players} />
              <ChoiceSelect
                name="choice"
                label="Public ballot"
                defaultValue="yes"
                allowEmpty
                id={`new-choice-${nomination.id}`}
              />
              <div className="space-y-1.5">
                <Label htmlFor={`new-reason-${nomination.id}`}>Public reason</Label>
                <Input id={`new-reason-${nomination.id}`} name="reason" />
              </div>
              <ChoiceSelect
                name="privateChoice"
                label="Private ballot"
                allowEmpty
                id={`new-private-choice-${nomination.id}`}
              />
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                <Label htmlFor={`new-private-reason-${nomination.id}`}>Private reason</Label>
                <Input id={`new-private-reason-${nomination.id}`} name="privateReason" />
              </div>
              <div className="col-span-full flex flex-wrap items-center gap-3">
                <SubmitButton>Add vote</SubmitButton>
                <SaveStatus result={voteCreateResult} />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NominationsSection({
  gameId,
  players,
  days,
  nominations,
  discordRefreshPendingSince,
}: {
  gameId: string;
  players: NominationPlayerOption[];
  days: Array<{ id: string; dayNumber: number }>;
  nominations: EditableNomination[];
  discordRefreshPendingSince: Date | null;
}) {
  const [createResult, createAction] = useActionState<SaveResult | null, FormData>(
    saveNomination.bind(null, gameId, null),
    null,
  );
  const [openId, setOpenId] = useState<string | null>(null);

  const sortedNominations = useMemo(
    () =>
      [...nominations].sort(
        (a, b) => a.dayNumber - b.dayNumber || a.order - b.order || a.id.localeCompare(b.id),
      ),
    [nominations],
  );

  const nextOrder =
    sortedNominations.reduce((max, nomination) => Math.max(max, nomination.order), 0) + 1;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Projection edits are SQLite-only until you push them. Use{" "}
        <strong>Push noms to Discord</strong> (bot picks up within ~30s) or{" "}
        <code>/st refresh-noms</code> for an immediate update — that syncs new noms, accusations,
        defenses, and votes into the event log and Town Voting embeds.
      </p>
      <RefreshNomsButton gameId={gameId} pendingSince={discordRefreshPendingSince} />

      {sortedNominations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No nominations recorded.</p>
      ) : (
        <div className="space-y-2">
          {sortedNominations.map((nomination) => (
            <NominationAccordionItem
              key={nomination.id}
              gameId={gameId}
              nomination={nomination}
              players={players}
              days={days}
              open={openId === nomination.id}
              onToggle={() =>
                setOpenId((current) => (current === nomination.id ? null : nomination.id))
              }
            />
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create a game day before adding nominations.</p>
      ) : players.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add players before creating nominations.</p>
      ) : (
        <form
          action={createAction}
          className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <h3 className="col-span-full text-sm font-medium">Add nomination</h3>
          <div className="space-y-1.5">
            <Label htmlFor="new-gameDayId">Game day</Label>
            <select
              id="new-gameDayId"
              name="gameDayId"
              required
              defaultValue={days[days.length - 1]?.id}
              className={formSelectClassName}
            >
              {days.map((day) => (
                <option key={day.id} value={day.id}>
                  Day {day.dayNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-order">Order</Label>
            <Input
              id="new-order"
              name="order"
              type="number"
              required
              defaultValue={nextOrder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-status">Status</Label>
            <select id="new-status" name="status" defaultValue="open" className={formSelectClassName}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <PlayerSelect name="nominatorId" label="Nominator" players={players} />
          <PlayerSelect name="nomineeId" label="Nominee" players={players} />
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="new-accusation">Accusation</Label>
            <Textarea id="new-accusation" name="accusation" rows={2} required />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="new-defense">Defense</Label>
            <Textarea id="new-defense" name="defense" rows={2} />
          </div>
          <div className="col-span-full flex flex-wrap items-center gap-3">
            <SubmitButton>Create nomination</SubmitButton>
            <SaveStatus result={createResult} />
          </div>
        </form>
      )}
    </div>
  );
}

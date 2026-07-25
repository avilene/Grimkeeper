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
  "h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm",
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
  choice: string;
  reason: string | null;
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

function votesSummary(votes: EditableVote[]): string {
  if (votes.length === 0) return "—";
  let yes = 0;
  let no = 0;
  let conditional = 0;
  for (const vote of votes) {
    if (vote.choice === "yes") yes += 1;
    else if (vote.choice === "no") no += 1;
    else if (vote.choice === "conditional") conditional += 1;
  }
  return `${yes}Y · ${no}N · ${conditional}C`;
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

function NominationTableRow({
  gameId,
  nomination,
  players,
  days,
  expanded,
  onToggleExpanded,
}: {
  gameId: string;
  nomination: EditableNomination;
  players: NominationPlayerOption[];
  days: Array<{ id: string; dayNumber: number }>;
  expanded: boolean;
  onToggleExpanded: () => void;
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

  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell className="w-16">
          <form id={formId} action={saveAction} />
          <Input
            form={formId}
            name="order"
            type="number"
            defaultValue={nomination.order}
            required
            className={cn(cellInputClass, "w-14")}
            aria-label={`Order for nomination ${nomination.order}`}
          />
        </TableCell>
        <TableCell className="w-28">
          <select
            form={formId}
            name="gameDayId"
            defaultValue={nomination.gameDayId}
            className={selectClassName}
            required
            aria-label={`Day for nomination ${nomination.order}`}
          >
            {days.map((day) => (
              <option key={day.id} value={day.id}>
                Day {day.dayNumber}
              </option>
            ))}
          </select>
        </TableCell>
        <TableCell className="min-w-[9rem]">
          <PlayerSelect
            form={formId}
            name="nominatorId"
            label={null}
            players={players}
            defaultValue={nomination.nominatorId}
            compact
            id={`nominator-${nomination.id}`}
          />
        </TableCell>
        <TableCell className="min-w-[9rem]">
          <PlayerSelect
            form={formId}
            name="nomineeId"
            label={null}
            players={players}
            defaultValue={nomination.nomineeId}
            compact
            id={`nominee-${nomination.id}`}
          />
        </TableCell>
        <TableCell className="min-w-[12rem]">
          <Input
            form={formId}
            name="accusation"
            defaultValue={nomination.accusation}
            required
            className={cn(cellInputClass, "min-w-[12rem]")}
            aria-label={`Accusation for nomination ${nomination.order}`}
          />
          {expanded ? null : (
            <input
              form={formId}
              type="hidden"
              name="defense"
              defaultValue={nomination.defense ?? ""}
            />
          )}
        </TableCell>
        <TableCell className="w-36">
          <select
            form={formId}
            name="status"
            defaultValue={nomination.status}
            className={selectClassName}
            aria-label={`Status for nomination ${nomination.order}`}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="text-left underline-offset-2 hover:underline"
            aria-expanded={expanded}
          >
            {votesSummary(nomination.votes)}
            <span className="ml-1 text-foreground/70">({nomination.votes.length})</span>
          </button>
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button type="submit" form={formId} size="sm">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onToggleExpanded}>
                {expanded ? "Hide" : "Votes"}
              </Button>
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
                  Delete
                </Button>
              </form>
            </div>
            <SaveStatus result={saveResult} />
            <SaveStatus result={deleteResult} />
          </div>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="bg-muted/30">
            <div className="space-y-4 p-1">
              <div className="space-y-1.5">
                <Label htmlFor={`defense-${nomination.id}`}>Defense</Label>
                <Textarea
                  form={formId}
                  id={`defense-${nomination.id}`}
                  name="defense"
                  defaultValue={nomination.defense ?? ""}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Save the nomination row to persist defense changes.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Votes ({nomination.votes.length})</h4>
                {nomination.votes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No votes yet.</p>
                ) : (
                  <div className="space-y-2">
                    {nomination.votes.map((vote) => (
                      <VoteRow
                        key={vote.id}
                        gameId={gameId}
                        vote={vote}
                        players={players}
                        nominations={[
                          {
                            id: nomination.id,
                            label: `Day ${nomination.dayNumber} #${nomination.order}`,
                          },
                        ]}
                      />
                    ))}
                  </div>
                )}

                <form
                  action={voteCreateAction}
                  className="grid gap-3 rounded-md border border-dashed border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <input type="hidden" name="nominationId" value={nomination.id} />
                  <PlayerSelect name="voterId" label="Voter" players={players} />
                  <div className="space-y-1.5">
                    <Label htmlFor={`new-choice-${nomination.id}`}>Choice</Label>
                    <select
                      id={`new-choice-${nomination.id}`}
                      name="choice"
                      defaultValue="yes"
                      className={formSelectClassName}
                    >
                      {CHOICES.map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                    <Label htmlFor={`new-reason-${nomination.id}`}>Reason</Label>
                    <Input id={`new-reason-${nomination.id}`} name="reason" />
                  </div>
                  <div className="col-span-full flex flex-wrap items-center gap-3">
                    <SubmitButton>Add vote</SubmitButton>
                    <SaveStatus result={voteCreateResult} />
                  </div>
                </form>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function VoteRow({
  gameId,
  vote,
  players,
  nominations,
}: {
  gameId: string;
  vote: EditableVote;
  players: NominationPlayerOption[];
  nominations: Array<{ id: string; label: string }>;
}) {
  const [saveResult, saveAction] = useActionState<SaveResult | null, FormData>(
    saveVote.bind(null, gameId, vote.id),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteVote.bind(null, gameId, vote.id),
    null,
  );

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card p-3">
      <form action={saveAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Nomination</Label>
          <select
            name="nominationId"
            defaultValue={vote.nominationId}
            className={formSelectClassName}
            required
          >
            {nominations.map((nomination) => (
              <option key={nomination.id} value={nomination.id}>
                {nomination.label}
              </option>
            ))}
          </select>
        </div>
        <PlayerSelect name="voterId" label="Voter" players={players} defaultValue={vote.voterId} />
        <div className="space-y-1.5">
          <Label>Choice</Label>
          <select name="choice" defaultValue={vote.choice} className={formSelectClassName}>
            {CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Input name="reason" defaultValue={vote.reason ?? ""} />
        </div>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <SubmitButton>Save vote</SubmitButton>
          <SaveStatus result={saveResult} />
        </div>
      </form>
      <form action={deleteAction} className="flex items-center gap-2">
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={(event) => {
            if (!window.confirm("Delete this vote?")) event.preventDefault();
          }}
        >
          Delete vote
        </Button>
        <SaveStatus result={deleteResult} />
      </form>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Nominator</TableHead>
              <TableHead>Nominee</TableHead>
              <TableHead>Accusation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Votes</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedNominations.map((nomination) => (
              <NominationTableRow
                key={nomination.id}
                gameId={gameId}
                nomination={nomination}
                players={players}
                days={days}
                expanded={expandedId === nomination.id}
                onToggleExpanded={() =>
                  setExpandedId((current) => (current === nomination.id ? null : nomination.id))
                }
              />
            ))}
          </TableBody>
        </Table>
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

"use client";

import { useActionState } from "react";

import {
  deleteNomination,
  deleteVote,
  saveNomination,
  saveVote,
  type SaveResult,
} from "@/actions/games";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, shortId } from "@/lib/utils";

const STATUSES = ["open", "resolved_pass", "resolved_fail", "executed"] as const;
const CHOICES = ["yes", "no", "conditional"] as const;

const selectClassName = cn(
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

function PlayerSelect({
  name,
  label,
  players,
  defaultValue,
}: {
  name: string;
  label: string;
  players: NominationPlayerOption[];
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        required
        defaultValue={defaultValue ?? ""}
        className={selectClassName}
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

function NominationCard({
  gameId,
  nomination,
  players,
  days,
}: {
  gameId: string;
  nomination: EditableNomination;
  players: NominationPlayerOption[];
  days: Array<{ id: string; dayNumber: number }>;
}) {
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
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          Day {nomination.dayNumber} · order {nomination.order} ·{" "}
          <code className="text-xs">{shortId(nomination.id)}</code>
        </h3>
        <span className="text-xs text-muted-foreground">{nomination.status}</span>
      </div>

      <form action={saveAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`day-${nomination.id}`}>Game day</Label>
          <select
            id={`day-${nomination.id}`}
            name="gameDayId"
            defaultValue={nomination.gameDayId}
            className={selectClassName}
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
          <Label htmlFor={`status-${nomination.id}`}>Status</Label>
          <select
            id={`status-${nomination.id}`}
            name="status"
            defaultValue={nomination.status}
            className={selectClassName}
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
        />
        <PlayerSelect
          name="nomineeId"
          label="Nominee"
          players={players}
          defaultValue={nomination.nomineeId}
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

      <form action={deleteAction} className="flex flex-wrap items-center gap-2">
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
        <SaveStatus result={deleteResult} />
      </form>

      <div className="space-y-3 border-t border-border pt-3">
        <h4 className="text-sm font-medium">Votes ({nomination.votes.length})</h4>
        {nomination.votes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No votes yet.</p>
        ) : (
          nomination.votes.map((vote) => (
            <VoteRow
              key={vote.id}
              gameId={gameId}
              vote={vote}
              players={players}
              nominations={[{ id: nomination.id, label: `Day ${nomination.dayNumber} #${nomination.order}` }]}
            />
          ))
        )}

        <form
          action={voteCreateAction}
          className="grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="nominationId" value={nomination.id} />
          <PlayerSelect name="voterId" label="Voter" players={players} />
          <div className="space-y-1.5">
            <Label htmlFor={`new-choice-${nomination.id}`}>Choice</Label>
            <select
              id={`new-choice-${nomination.id}`}
              name="choice"
              defaultValue="yes"
              className={selectClassName}
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
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <form action={saveAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Nomination</Label>
          <select
            name="nominationId"
            defaultValue={vote.nominationId}
            className={selectClassName}
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
          <select name="choice" defaultValue={vote.choice} className={selectClassName}>
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
}: {
  gameId: string;
  players: NominationPlayerOption[];
  days: Array<{ id: string; dayNumber: number }>;
  nominations: EditableNomination[];
}) {
  const [createResult, createAction] = useActionState<SaveResult | null, FormData>(
    saveNomination.bind(null, gameId, null),
    null,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Projection edits only — they do not append engine events or refresh Discord nomination
        posts. Prefer bot commands during a live day.
      </p>

      {nominations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No nominations recorded.</p>
      ) : (
        nominations.map((nomination) => (
          <NominationCard
            key={nomination.id}
            gameId={gameId}
            nomination={nomination}
            players={players}
            days={days}
          />
        ))
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
              className={selectClassName}
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
              defaultValue={nominations.length + 1}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-status">Status</Label>
            <select id="new-status" name="status" defaultValue="open" className={selectClassName}>
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

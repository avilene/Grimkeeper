"use client";

import { useActionState } from "react";

import { deleteGameDay, saveGameDay, type SaveResult } from "@/actions/games";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { TimezoneOffsetInput } from "@/components/timezone-offset-input";
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
import { cn } from "@/lib/utils";

export type EditableGameDay = {
  id: string;
  dayNumber: number;
  discordThreadId: string | null;
  nominationsOpen: boolean;
  voteVisibility: string;
  executionUsed: boolean;
  nominationsPausedUntil: Date | null;
};

const selectClassName = cn(
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

function toDatetimeLocal(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function DayRowForm({ gameId, day }: { gameId: string; day: EditableGameDay }) {
  const [saveResult, saveAction] = useActionState<SaveResult | null, FormData>(
    saveGameDay.bind(null, gameId, day.id),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteGameDay.bind(null, gameId, day.id),
    null,
  );

  return (
    <TableRow className="hover:bg-transparent align-top">
      <TableCell colSpan={6} className="p-2">
        <form action={saveAction} className="grid gap-2 sm:grid-cols-6">
          <TimezoneOffsetInput />
          <div className="space-y-1">
            <Label className="text-xs">Day #</Label>
            <Input name="dayNumber" type="number" defaultValue={day.dayNumber} className="h-8" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Discord thread</Label>
            <Input
              name="discordThreadId"
              defaultValue={day.discordThreadId ?? ""}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Vote visibility</Label>
            <select
              name="voteVisibility"
              defaultValue={day.voteVisibility}
              className={selectClassName}
            >
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Nominations paused until</Label>
            <Input
              name="nominationsPausedUntil"
              type="datetime-local"
              defaultValue={toDatetimeLocal(day.nominationsPausedUntil)}
              className="h-8"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="nominationsOpen"
              defaultChecked={day.nominationsOpen}
              className="size-4 rounded border-input"
            />
            Nominations open
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="executionUsed"
              defaultChecked={day.executionUsed}
              className="size-4 rounded border-input"
            />
            Execution used
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
            <SubmitButton>Save day</SubmitButton>
            <SaveStatus result={saveResult} />
          </div>
        </form>
        <form action={deleteAction} className="mt-2 flex items-center gap-2">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={(event) => {
              if (!window.confirm(`Delete day ${day.dayNumber}?`)) {
                event.preventDefault();
              }
            }}
          >
            Delete day
          </Button>
          <SaveStatus result={deleteResult} />
        </form>
      </TableCell>
    </TableRow>
  );
}

export function GameDaysSection({
  gameId,
  days,
}: {
  gameId: string;
  days: EditableGameDay[];
}) {
  const [createResult, createAction] = useActionState<SaveResult | null, FormData>(
    saveGameDay.bind(null, gameId, null),
    null,
  );

  return (
    <div className="space-y-4">
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No game days recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <DayRowForm key={day.id} gameId={gameId} day={day} />
            ))}
          </TableBody>
        </Table>
      )}

      <form
        action={createAction}
        className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <TimezoneOffsetInput />
        <h3 className="col-span-full text-sm font-medium">Add day</h3>
        <div className="space-y-1.5">
          <Label htmlFor="new-dayNumber">Day number</Label>
          <Input id="new-dayNumber" name="dayNumber" type="number" required defaultValue={1} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-discordThreadId">Discord thread ID</Label>
          <Input id="new-discordThreadId" name="discordThreadId" className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-voteVisibility">Vote visibility</Label>
          <select
            id="new-voteVisibility"
            name="voteVisibility"
            defaultValue="public"
            className={selectClassName}
          >
            <option value="public">public</option>
            <option value="private">private</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="nominationsOpen"
            defaultChecked
            className="size-4 rounded border-input"
          />
          Nominations open
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="executionUsed" className="size-4 rounded border-input" />
          Execution used
        </label>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <SubmitButton>Create day</SubmitButton>
          <SaveStatus result={createResult} />
        </div>
      </form>
    </div>
  );
}

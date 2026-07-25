"use client";

import { useActionState } from "react";

import { deleteReminder, saveReminder, type SaveResult } from "@/actions/reminders";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReminderFields = {
  id: string;
  message: string;
  guildId: string;
  channelId: string;
  gameId: string | null;
  fireAt: Date;
  emoji: string | null;
  pingPlayers: boolean;
  pingRoleId: string | null;
  fired: boolean;
};

function toDatetimeLocal(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function ReminderForm({
  reminder,
  defaultGameId,
}: {
  reminder?: ReminderFields;
  defaultGameId?: string;
}) {
  const reminderId = reminder?.id ?? null;
  const [result, action] = useActionState<SaveResult | null, FormData>(
    saveReminder.bind(null, reminderId),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteReminder.bind(null, reminder?.id ?? ""),
    null,
  );

  return (
    <div className="space-y-4">
      <form
        action={action}
        className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2"
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="message">Message</Label>
          <Textarea id="message" name="message" required defaultValue={reminder?.message ?? ""} rows={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fireAt">Fire at</Label>
          <Input
            id="fireAt"
            name="fireAt"
            type="datetime-local"
            required
            defaultValue={reminder ? toDatetimeLocal(reminder.fireAt) : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emoji">Emoji</Label>
          <Input id="emoji" name="emoji" defaultValue={reminder?.emoji ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guildId">Guild ID</Label>
          <Input
            id="guildId"
            name="guildId"
            required
            className="font-mono"
            defaultValue={reminder?.guildId ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channelId">Channel ID</Label>
          <Input
            id="channelId"
            name="channelId"
            required
            className="font-mono"
            defaultValue={reminder?.channelId ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gameId">Game ID (optional)</Label>
          <Input
            id="gameId"
            name="gameId"
            className="font-mono"
            defaultValue={reminder?.gameId ?? defaultGameId ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pingRoleId">Ping role ID</Label>
          <Input
            id="pingRoleId"
            name="pingRoleId"
            className="font-mono"
            defaultValue={reminder?.pingRoleId ?? ""}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="pingPlayers"
            defaultChecked={reminder?.pingPlayers ?? false}
            className="size-4 rounded border-input"
          />
          Ping players
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="fired"
            defaultChecked={reminder?.fired ?? false}
            className="size-4 rounded border-input"
          />
          Fired
        </label>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <SubmitButton>{reminder ? "Save reminder" : "Create reminder"}</SubmitButton>
          <SaveStatus result={result} />
        </div>
      </form>

      {reminder ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="destructive"
            onClick={(event) => {
              if (!window.confirm("Delete this reminder?")) event.preventDefault();
            }}
          >
            Delete reminder
          </Button>
          <SaveStatus result={deleteResult} />
        </form>
      ) : null}
    </div>
  );
}

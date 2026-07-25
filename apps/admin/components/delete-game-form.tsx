"use client";

import { useActionState } from "react";

import { deleteGame, type SaveResult } from "@/actions/games";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteGameForm({ gameId }: { gameId: string }) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    deleteGame.bind(null, gameId),
    null,
  );

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-destructive/40 bg-card p-4"
    >
      <p className="text-sm text-muted-foreground">
        Permanently delete this game and cascaded projection rows (players, days, reminders,
        events). Type <code>DELETE</code> to confirm.
      </p>
      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="confirm-delete">Confirmation</Label>
        <Input id="confirm-delete" name="confirm" placeholder="DELETE" autoComplete="off" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="destructive" pendingLabel="Deleting…">
          Delete game
        </SubmitButton>
        <SaveStatus result={result} />
      </div>
    </form>
  );
}

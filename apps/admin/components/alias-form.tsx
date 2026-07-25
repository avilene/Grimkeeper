"use client";

import { useActionState } from "react";

import { deleteAlias, saveAlias, type SaveResult } from "@/actions/aliases";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AliasFields = {
  guildId: string;
  discordUserId: string;
  alias: string;
};

export function AliasForm({ aliasRow }: { aliasRow?: AliasFields }) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    saveAlias.bind(null, aliasRow?.guildId ?? null, aliasRow?.discordUserId ?? null),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteAlias.bind(null, aliasRow?.guildId ?? "", aliasRow?.discordUserId ?? ""),
    null,
  );

  return (
    <div className="space-y-4">
      <form
        action={action}
        className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3"
      >
        <div className="space-y-1.5">
          <Label htmlFor="guildId">Guild ID</Label>
          <Input
            id="guildId"
            name="guildId"
            required
            className="font-mono"
            defaultValue={aliasRow?.guildId ?? ""}
            readOnly={Boolean(aliasRow)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="discordUserId">Discord user ID</Label>
          <Input
            id="discordUserId"
            name="discordUserId"
            required
            className="font-mono"
            defaultValue={aliasRow?.discordUserId ?? ""}
            readOnly={Boolean(aliasRow)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alias">Alias</Label>
          <Input id="alias" name="alias" required defaultValue={aliasRow?.alias ?? ""} />
        </div>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <SubmitButton>{aliasRow ? "Save alias" : "Create alias"}</SubmitButton>
          <SaveStatus result={result} />
        </div>
      </form>

      {aliasRow ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="destructive"
            onClick={(event) => {
              if (!window.confirm(`Delete alias ${aliasRow.alias}?`)) event.preventDefault();
            }}
          >
            Delete alias
          </Button>
          <SaveStatus result={deleteResult} />
        </form>
      ) : null}
    </div>
  );
}

"use client";

import { useActionState } from "react";

import { requestNomsDiscordRefresh, type SaveResult } from "@/actions/games";
import { LocalTime } from "@/components/local-time";
import { SaveStatus, SubmitButton } from "@/components/save-form";

export function RefreshNomsButton({
  gameId,
  pendingSince,
}: {
  gameId: string;
  pendingSince: Date | null;
}) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    requestNomsDiscordRefresh.bind(null, gameId),
    null,
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel="Queueing…">Push noms to Discord</SubmitButton>
      <SaveStatus result={result} />
      {pendingSince ? (
        <span className="text-xs text-muted-foreground">
          Refresh queued at <LocalTime value={pendingSince} /> — waiting for bot…
        </span>
      ) : null}
    </form>
  );
}

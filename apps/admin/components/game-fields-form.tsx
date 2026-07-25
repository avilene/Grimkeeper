"use client";

import { useActionState } from "react";

import { saveGame, type SaveResult } from "@/actions/games";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PHASES = ["lobby", "setup", "night", "day", "ended"] as const;
const WINNERS = [
  { value: "", label: "—" },
  { value: "good", label: "Good" },
  { value: "evil", label: "Evil" },
] as const;

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

type GameFields = {
  phase: string;
  winner: string | null;
  dayNumber: number;
  nightNumber: number;
  guildId: string;
  channelId: string;
  source: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  stRoleId: string | null;
  playerRoleId: string | null;
  kibRoleId: string | null;
  kibThreadId: string | null;
  logThreadId: string | null;
  votingThreadId: string | null;
  whisperDeclThreadId: string | null;
  claimsThreadId: string | null;
  rulesThreadId: string | null;
};

function toDatetimeLocal(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

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

export function GameFieldsForm({ gameId, game }: { gameId: string; game: GameFields }) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    saveGame.bind(null, gameId),
    null,
  );

  return (
    <form
      action={action}
      className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="phase">Phase</Label>
        <select
          id="phase"
          name="phase"
          defaultValue={game.phase}
          className={selectClassName}
        >
          {PHASES.map((phase) => (
            <option key={phase} value={phase}>
              {phase}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="winner">Winner</Label>
        <select
          id="winner"
          name="winner"
          defaultValue={game.winner ?? ""}
          className={selectClassName}
        >
          {WINNERS.map((winner) => (
            <option key={winner.value || "none"} value={winner.value}>
              {winner.label}
            </option>
          ))}
        </select>
      </div>
      <Field name="dayNumber" label="Day number" type="number" defaultValue={game.dayNumber} />
      <Field name="nightNumber" label="Night number" type="number" defaultValue={game.nightNumber} />
      <Field name="guildId" label="Guild ID" defaultValue={game.guildId} />
      <Field name="channelId" label="Town channel ID" defaultValue={game.channelId} />
      <div className="space-y-1.5">
        <Label htmlFor="source">Source</Label>
        <Input
          id="source"
          readOnly
          value={game.source ?? "live"}
          className="font-mono text-muted-foreground"
        />
      </div>
      <Field
        name="startedAt"
        label="Started at"
        type="datetime-local"
        defaultValue={toDatetimeLocal(game.startedAt)}
      />
      <Field
        name="endedAt"
        label="Ended at"
        type="datetime-local"
        defaultValue={toDatetimeLocal(game.endedAt)}
      />
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
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <SubmitButton>Save game</SubmitButton>
        <SaveStatus result={result} />
      </div>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";

import { savePlayers, type SaveResult } from "@/actions/games";
import { RoleCombobox, type RoleOption } from "@/components/role-combobox";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PLAYER_TEAMS = [
  { value: "", label: "—" },
  { value: "good", label: "Good" },
  { value: "evil", label: "Evil" },
  { value: "traveler", label: "Traveler" },
] as const;

const cellInputClass = cn(
  "h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

const selectClassName = cn(cellInputClass, "w-full");

export type EditablePlayer = {
  id: string;
  displayName: string;
  discordUserId: string;
  seat: number | null;
  roleId: string | null;
  team: string | null;
  alive: boolean;
  ghostVoteUsed: boolean;
};

type RowState = {
  displayName: string;
  discordUserId: string;
  seat: string;
  roleId: string;
  team: string;
  alive: boolean;
  ghostVoteUsed: boolean;
};

function rowsFromPlayers(players: EditablePlayer[]): Record<string, RowState> {
  return Object.fromEntries(
    players.map((player) => [
      player.id,
      {
        displayName: player.displayName,
        discordUserId: player.discordUserId,
        seat: player.seat == null ? "" : String(player.seat),
        roleId: player.roleId ?? "",
        team: player.team ?? "",
        alive: player.alive,
        ghostVoteUsed: player.ghostVoteUsed,
      },
    ]),
  );
}

function patchRow(
  rows: Record<string, RowState>,
  playerId: string,
  patch: Partial<RowState>,
): Record<string, RowState> {
  const current = rows[playerId];
  if (!current) return rows;
  return { ...rows, [playerId]: { ...current, ...patch } };
}

export function PlayersTableForm({
  gameId,
  players,
  roles,
}: {
  gameId: string;
  players: EditablePlayer[];
  roles: RoleOption[];
}) {
  const [rows, setRows] = useState(() => rowsFromPlayers(players));
  const [result, action] = useActionState<SaveResult | null, FormData>(
    savePlayers.bind(null, gameId),
    null,
  );

  if (players.length === 0) {
    return <p className="text-sm text-muted-foreground">No players.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Seat</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Discord ID</TableHead>
            <TableHead>Character</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-center">Alive</TableHead>
            <TableHead className="text-center">Ghost used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.map((player) => {
            const row = rows[player.id] ?? rowsFromPlayers([player])[player.id]!;
            return (
              <TableRow key={player.id} className="hover:bg-transparent">
                <TableCell className="w-20">
                  <input type="hidden" name="playerId" value={player.id} />
                  <Input
                    name={`seat_${player.id}`}
                    type="number"
                    value={row.seat}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, { seat: event.target.value }),
                      )
                    }
                    className={cn(cellInputClass, "w-16")}
                    aria-label={`Seat for ${player.displayName}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    name={`displayName_${player.id}`}
                    value={row.displayName}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, { displayName: event.target.value }),
                      )
                    }
                    className={cellInputClass}
                    aria-label={`Display name for ${player.displayName}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    name={`discordUserId_${player.id}`}
                    value={row.discordUserId}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, { discordUserId: event.target.value }),
                      )
                    }
                    className={cn(cellInputClass, "min-w-[10rem] font-mono text-xs")}
                    aria-label={`Discord ID for ${player.displayName}`}
                  />
                </TableCell>
                <TableCell className="min-w-[14rem]">
                  <RoleCombobox
                    id={`role-${player.id}`}
                    name={`roleId_${player.id}`}
                    label={null}
                    value={row.roleId}
                    onValueChange={(roleId, meta) =>
                      setRows((prev) => {
                        const current = prev[player.id];
                        const teamEmpty = !current?.team;
                        return patchRow(prev, player.id, {
                          roleId,
                          ...(teamEmpty && meta?.team ? { team: meta.team } : {}),
                        });
                      })
                    }
                    roles={roles}
                    compact
                  />
                </TableCell>
                <TableCell className="w-32">
                  <select
                    id={`team-${player.id}`}
                    name={`team_${player.id}`}
                    value={row.team}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, { team: event.target.value }),
                      )
                    }
                    className={selectClassName}
                    aria-label={`Team for ${player.displayName}`}
                  >
                    {PLAYER_TEAMS.map((team) => (
                      <option key={team.value || "none"} value={team.value}>
                        {team.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-center">
                  <input
                    type="checkbox"
                    name={`alive_${player.id}`}
                    checked={row.alive}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, { alive: event.target.checked }),
                      )
                    }
                    className="size-4 rounded border-input"
                    aria-label={`Alive for ${player.displayName}`}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <input
                    type="checkbox"
                    name={`ghostVoteUsed_${player.id}`}
                    checked={row.ghostVoteUsed}
                    onChange={(event) =>
                      setRows((prev) =>
                        patchRow(prev, player.id, {
                          ghostVoteUsed: event.target.checked,
                        }),
                      )
                    }
                    className="size-4 rounded border-input"
                    aria-label={`Ghost vote used for ${player.displayName}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save players</SubmitButton>
        <SaveStatus result={result} />
      </div>
    </form>
  );
}

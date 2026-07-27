"use client";

import { useActionState, useState } from "react";

import { recordCompletedGameAction, type SaveResult } from "@/actions/games";
import {
  RoleCombobox,
  alignmentFromRoleType,
  type RoleOption,
} from "@/components/role-combobox";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { TimezoneOffsetInput } from "@/components/timezone-offset-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Must match STATS_ONLY_CHANNEL_ID in @grimkeeper/database (client-safe copy). */
const STATS_ONLY_CHANNEL_PLACEHOLDER = "stats-only";

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

const PLAYER_TEAMS = [
  { value: "", label: "—" },
  { value: "good", label: "Good" },
  { value: "evil", label: "Evil" },
  { value: "traveler", label: "Traveler" },
] as const;

type PlayerDraft = {
  key: string;
  discordUserId: string;
  displayName: string;
  seat: string;
  roleId: string;
  team: string;
};

let playerKeySeq = 0;

function newPlayer(): PlayerDraft {
  playerKeySeq += 1;
  return {
    key: `player-${playerKeySeq}-${Date.now()}`,
    discordUserId: "",
    displayName: "",
    seat: "",
    roleId: "",
    team: "",
  };
}

export function RecordGameForm({ roles }: { roles: RoleOption[] }) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    recordCompletedGameAction,
    null,
  );
  const [players, setPlayers] = useState<PlayerDraft[]>([newPlayer(), newPlayer()]);

  return (
    <form action={action} className="space-y-6">
      <TimezoneOffsetInput />
      <div className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="guildId">Guild ID</Label>
          <Input id="guildId" name="guildId" required className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channelId">Channel ID (optional)</Label>
          <Input
            id="channelId"
            name="channelId"
            className="font-mono"
            placeholder={STATS_ONLY_CHANNEL_PLACEHOLDER}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank for sentinel <code>{STATS_ONLY_CHANNEL_PLACEHOLDER}</code>. No Discord
            posts.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="winner">Winner</Label>
          <select id="winner" name="winner" required defaultValue="good" className={selectClassName}>
            <option value="good">Good</option>
            <option value="evil">Evil</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="startedAt">Started at</Label>
            <Input id="startedAt" name="startedAt" type="datetime-local" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endedAt">Ended at</Label>
            <Input id="endedAt" name="endedAt" type="datetime-local" required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="storytellerId">Primary ST Discord ID</Label>
          <Input id="storytellerId" name="storytellerId" required className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="coStorytellerIds">Co-ST Discord IDs</Label>
          <Input
            id="coStorytellerIds"
            name="coStorytellerIds"
            className="font-mono"
            placeholder="comma or space separated"
          />
          <p className="text-xs text-muted-foreground">
            Stored as <code>StorytellerPromoted</code> events (same as live games).
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Players ({players.length})</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPlayers((current) => [...current, newPlayer()])}
          >
            Add player
          </Button>
        </div>
        <div className="space-y-3">
          {players.map((player, index) => (
            <div
              key={player.key}
              className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor={`discord_${player.key}`}>Discord user ID</Label>
                <Input
                  id={`discord_${player.key}`}
                  name="playerDiscordUserId"
                  required
                  className="font-mono"
                  value={player.discordUserId}
                  onChange={(event) =>
                    setPlayers((current) =>
                      current.map((row) =>
                        row.key === player.key
                          ? { ...row, discordUserId: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`name_${player.key}`}>Display name</Label>
                <Input
                  id={`name_${player.key}`}
                  name="playerDisplayName"
                  required
                  value={player.displayName}
                  onChange={(event) =>
                    setPlayers((current) =>
                      current.map((row) =>
                        row.key === player.key
                          ? { ...row, displayName: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`seat_${player.key}`}>Seat</Label>
                <Input
                  id={`seat_${player.key}`}
                  name="playerSeat"
                  type="number"
                  min={1}
                  value={player.seat}
                  onChange={(event) =>
                    setPlayers((current) =>
                      current.map((row) =>
                        row.key === player.key ? { ...row, seat: event.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <RoleCombobox
                  id={`role_${player.key}`}
                  name="playerRoleId"
                  label="Role"
                  value={player.roleId}
                  roles={roles}
                  onValueChange={(roleId, meta) =>
                    setPlayers((current) =>
                      current.map((row) => {
                        if (row.key !== player.key) return row;
                        const team =
                          meta?.team ??
                          (roles.find((role) => role.id === roleId)
                            ? alignmentFromRoleType(
                                roles.find((role) => role.id === roleId)!.type,
                              )
                            : row.team);
                        return { ...row, roleId, team: team || row.team };
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`team_${player.key}`}>Team</Label>
                <select
                  id={`team_${player.key}`}
                  name="playerTeam"
                  className={selectClassName}
                  value={player.team}
                  onChange={(event) =>
                    setPlayers((current) =>
                      current.map((row) =>
                        row.key === player.key ? { ...row, team: event.target.value } : row,
                      ),
                    )
                  }
                >
                  {PLAYER_TEAMS.map((team) => (
                    <option key={team.value || "none"} value={team.value}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={players.length <= 1}
                  onClick={() =>
                    setPlayers((current) => current.filter((row) => row.key !== player.key))
                  }
                >
                  Remove player {index + 1}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record completed game</SubmitButton>
        <SaveStatus result={result} />
      </div>
    </form>
  );
}

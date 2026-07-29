"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { type BuffetConfigInput, saveBuffetConfig } from "@/actions/games";
import { SaveStatus } from "@/components/save-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SaveResult } from "@/lib/action-result";

type RoleTeam = "townsfolk" | "outsider" | "minion" | "demon" | "traveler";

export interface BuffetRole {
  id: string;
  name: string;
  team: RoleTeam;
  edition: string;
}

interface Props {
  gameId: string;
  roles: BuffetRole[];
  initialEnabledIds: string[];
  initialRecycle: boolean;
  /** Seated player count — used to show expected composition. */
  playerCount: number;
  draftStatus?: "idle" | "active" | "complete";
}

const TEAM_LABELS: Record<string, string> = {
  townsfolk: "Townsfolk",
  outsider: "Outsider",
  minion: "Minion",
  demon: "Demon",
  traveler: "Traveler",
};

const TEAM_COLORS: Record<string, string> = {
  townsfolk: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  outsider: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  minion: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  demon: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  traveler: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const EDITIONS: Array<{ label: string; value: string | null }> = [
  { label: "All", value: null },
  { label: "Trouble Brewing", value: "Trouble Brewing" },
  { label: "Bad Moon Rising", value: "Bad Moon Rising" },
  { label: "Sects & Violets", value: "Sects & Violets" },
];

const TEAMS: Array<{ label: string; value: string | null }> = [
  { label: "All", value: null },
  { label: "Townsfolk", value: "townsfolk" },
  { label: "Outsider", value: "outsider" },
  { label: "Minion", value: "minion" },
  { label: "Demon", value: "demon" },
];

const TB_COMPOSITION: Record<number, Record<string, number>> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

function getComposition(playerCount: number): Record<string, number> | null {
  return TB_COMPOSITION[playerCount] ?? null;
}

export function BuffetConfigForm({
  gameId,
  roles,
  initialEnabledIds,
  initialRecycle,
  playerCount,
  draftStatus,
}: Props) {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(
    () => new Set(initialEnabledIds.length > 0 ? initialEnabledIds : roles.map((r) => r.id)),
  );
  const [recycleUnchosen, setRecycleUnchosen] = useState(initialRecycle);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [editionFilter, setEditionFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredRoles = useMemo(() => {
    return roles.filter((r) => {
      if (r.team === "traveler") return false;
      if (teamFilter && r.team !== teamFilter) return false;
      if (editionFilter && r.edition !== editionFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!r.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [roles, teamFilter, editionFilter, search]);

  const nonTravelerRoles = useMemo(() => roles.filter((r) => r.team !== "traveler"), [roles]);

  const toggleRole = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      for (const r of filteredRoles) next.add(r.id);
      return next;
    });
  }, [filteredRoles]);

  const selectNone = useCallback(() => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      for (const r of filteredRoles) next.delete(r.id);
      return next;
    });
  }, [filteredRoles]);

  const composition = getComposition(playerCount);
  const enabledByTeam = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of enabledIds) {
      const role = roles.find((r) => r.id === id);
      if (!role || role.team === "traveler") continue;
      counts[role.team] = (counts[role.team] ?? 0) + 1;
    }
    return counts;
  }, [enabledIds, roles]);

  const poolProblems = useMemo(() => {
    if (!composition) return [];
    return Object.entries(composition)
      .filter(([team, needed]) => (enabledByTeam[team] ?? 0) < needed)
      .map(([team, needed]) => `Need ${needed} ${TEAM_LABELS[team] ?? team}, have ${enabledByTeam[team] ?? 0}`);
  }, [composition, enabledByTeam]);

  const handleSave = () => {
    const input: BuffetConfigInput = {
      enabledRoleIds: [...enabledIds],
      recycleUnchosen,
    };
    startTransition(async () => {
      const result = await saveBuffetConfig(gameId, input);
      setSaveResult(result);
    });
  };

  const isReadOnly = draftStatus === "active";

  return (
    <div className="space-y-5">
      {isReadOnly && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
          A draft is currently in progress. Cancel the draft with{" "}
          <code>/st do buffet-cancel</code> before changing the role pool.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Edition:</span>
        {EDITIONS.map((e) => (
          <Button
            key={e.value ?? "all"}
            size="sm"
            variant={editionFilter === e.value ? "default" : "outline"}
            onClick={() => setEditionFilter(e.value)}
            disabled={isReadOnly}
          >
            {e.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Team:</span>
        {TEAMS.map((t) => (
          <Button
            key={t.value ?? "all"}
            size="sm"
            variant={teamFilter === t.value ? "default" : "outline"}
            onClick={() => setTeamFilter(t.value)}
            disabled={isReadOnly}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search roles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isReadOnly}
        />
        <Button size="sm" variant="outline" onClick={selectAll} disabled={isReadOnly}>
          Select all ({filteredRoles.length})
        </Button>
        <Button size="sm" variant="outline" onClick={selectNone} disabled={isReadOnly}>
          Select none
        </Button>
      </div>

      {/* Role grid */}
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filteredRoles.map((role) => {
          const checked = enabledIds.has(role.id);
          return (
            <label
              key={role.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors ${
                checked
                  ? "border-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:border-muted-foreground/50"
              } ${isReadOnly ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRole(role.id)}
                disabled={isReadOnly}
                className="h-4 w-4 shrink-0"
              />
              <span className="truncate">{role.name}</span>
              <Badge
                variant="outline"
                className={`ml-auto shrink-0 text-xs ${TEAM_COLORS[role.team] ?? ""}`}
              >
                {role.team.slice(0, 2).toUpperCase()}
              </Badge>
            </label>
          );
        })}
        {filteredRoles.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">No roles match your filter.</p>
        )}
      </div>

      {/* Pool summary */}
      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
        <p className="font-medium">Pool summary ({enabledIds.size} / {nonTravelerRoles.length} enabled)</p>
        <div className="flex flex-wrap gap-3 text-muted-foreground">
          {(["townsfolk", "outsider", "minion", "demon"] as const).map((team) => (
            <span key={team}>
              {TEAM_LABELS[team]}: <strong>{enabledByTeam[team] ?? 0}</strong>
              {composition ? ` (need ${composition[team] ?? 0})` : ""}
            </span>
          ))}
        </div>
        {composition && playerCount > 0 ? (
          <p className="text-muted-foreground">
            Expected for {playerCount} players: TF {composition.townsfolk}, OS{" "}
            {composition.outsider}, MN {composition.minion}, DM {composition.demon}
          </p>
        ) : playerCount === 0 ? (
          <p className="text-muted-foreground italic">No seated players — seat players first to see composition.</p>
        ) : null}
        {poolProblems.length > 0 && (
          <ul className="list-disc pl-4 text-yellow-700 dark:text-yellow-400">
            {poolProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Draft options */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Draft options</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recycleUnchosen}
            onChange={(e) => setRecycleUnchosen(e.target.checked)}
            disabled={isReadOnly}
            className="h-4 w-4"
          />
          Recycle unchosen roles (unchosen options return to pool instead of being removed)
        </label>
        <p className="text-sm text-muted-foreground">
          Mulligan steps: <strong>3 → 2 → 1</strong> (fixed in v1)
        </p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isReadOnly || isPending}>
          {isPending ? "Saving…" : "Save buffet config"}
        </Button>
        <SaveStatus result={saveResult} />
      </div>
    </div>
  );
}

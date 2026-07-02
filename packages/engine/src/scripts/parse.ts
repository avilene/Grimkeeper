import type { RoleType } from "../plugins/trouble-brewing/roles.js";
import { troubleBrewingRoles } from "../plugins/trouble-brewing/roles.js";
import type { Team } from "../plugins/types.js";
import { badMoonRisingRoles } from "./bmr-roles.js";
import { sectsAndVioletsRoles } from "./snv-roles.js";
import type { GameScript, ScriptRole, ScriptSource, StandardEdition } from "./types.js";
import { StandardEdition as Edition } from "./types.js";

const officialCatalog = new Map(
  [...troubleBrewingRoles, ...badMoonRisingRoles, ...sectsAndVioletsRoles].map((role) => [role.id, role]),
);

const teamToType: Record<string, RoleType | undefined> = {
  townsfolk: "townsfolk",
  outsider: "outsider",
  minion: "minion",
  demon: "demon",
};

function titleCaseId(id: string): string {
  return id
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function roleFromObject(entry: Record<string, unknown>): ScriptRole | null {
  const id = typeof entry.id === "string" ? entry.id : null;
  if (!id || id === "_meta") return null;

  const known = officialCatalog.get(id);
  const team = (typeof entry.team === "string" ? entry.team : known?.team) as Team | undefined;
  const type =
    (typeof entry.type === "string" ? teamToType[entry.type] : undefined) ??
    (team ? teamToType[team] : undefined) ??
    known?.type;
  if (!type || !team) return null;

  return {
    id,
    name: typeof entry.name === "string" ? entry.name : known?.name ?? titleCaseId(id),
    type,
    team,
    ability:
      typeof entry.ability === "string" ? entry.ability : known?.ability ?? "See the almanac for this character.",
  };
}

export function parseScriptJson(
  raw: unknown,
  options?: { source?: ScriptSource; scriptUrl?: string },
): GameScript {
  if (!Array.isArray(raw)) {
    throw new Error("Script JSON must be an array.");
  }

  let name = "Custom Script";
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const object = entry as Record<string, unknown>;
      if (object.id === "_meta" && typeof object.name === "string") {
        name = object.name;
        break;
      }
    }
  }

  const roles: ScriptRole[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry === "_meta" || seen.has(entry)) continue;
      const known = officialCatalog.get(entry);
      if (!known) {
        throw new Error(`Unknown character id "${entry}" in script JSON.`);
      }
      roles.push({ ...known });
      seen.add(entry);
      continue;
    }

    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const role = roleFromObject(entry as Record<string, unknown>);
      if (!role || seen.has(role.id)) continue;
      roles.push(role);
      seen.add(role.id);
    }
  }

  if (roles.length < 5) {
    throw new Error("Script must include at least 5 characters.");
  }

  return {
    name,
    source: options?.source ?? "custom",
    scriptUrl: options?.scriptUrl,
    roles,
  };
}

export function resolveStandardScript(edition: StandardEdition): GameScript {
  switch (edition) {
    case Edition.TB:
      return {
        name: "Trouble Brewing",
        source: Edition.TB,
        roles: troubleBrewingRoles.map((role) => ({ ...role })),
      };
    case Edition.BMR:
      return {
        name: "Bad Moon Rising",
        source: Edition.BMR,
        roles: badMoonRisingRoles.map((role) => ({ ...role })),
      };
    case Edition.SNV:
      return {
        name: "Sects & Violets",
        source: Edition.SNV,
        roles: sectsAndVioletsRoles.map((role) => ({ ...role })),
      };
  }
}

export function findScriptRole(script: GameScript, roleQuery: string): ScriptRole | undefined {
  const normalized = roleQuery.trim().toLowerCase();
  return script.roles.find(
    (role) =>
      role.id === normalized ||
      role.name.toLowerCase() === normalized ||
      role.name.toLowerCase().replace(/\s+/g, "_") === normalized,
  );
}

export function getOfficialRole(roleId: string): ScriptRole | undefined {
  const role = officialCatalog.get(roleId);
  return role ? { ...role } : undefined;
}

export function formatScriptRoleName(script: GameScript | null, roleId: string): string {
  if (script) {
    const role = script.roles.find((candidate) => candidate.id === roleId);
    if (role) return role.name;
  }
  return officialCatalog.get(roleId)?.name ?? titleCaseId(roleId);
}

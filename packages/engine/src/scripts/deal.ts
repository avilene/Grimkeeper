import type { RoleType } from "../plugins/trouble-brewing/roles.js";
import { getTroubleBrewingComposition } from "../plugins/trouble-brewing/deal.js";
import type { ScriptRole } from "./types.js";

export function dealRolesFromScript(
  roles: ScriptRole[],
  playerCount: number,
  options?: { devMode?: boolean },
): string[] {
  const composition = getTroubleBrewingComposition(playerCount, options);
  const roleIds: string[] = [];

  for (const type of ["demon", "minion", "outsider", "townsfolk"] as RoleType[]) {
    const pool = roles.filter((role) => role.type === type).map((role) => role.id);
    const count = composition[type];
    const picked = pickUnique(pool, count);
    roleIds.push(...picked);
  }

  return shuffle(roleIds);
}

function pickUnique(pool: string[], count: number): string[] {
  const copy = shuffle([...pool]);
  if (count > copy.length) {
    throw new Error(`Script does not have enough ${count} roles in pool (only ${copy.length}).`);
  }
  return copy.slice(0, count);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function getScriptCompositionText(
  playerCount: number,
  options?: { devMode?: boolean },
): string {
  const composition = getTroubleBrewingComposition(playerCount, options);
  return Object.entries(composition)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");
}

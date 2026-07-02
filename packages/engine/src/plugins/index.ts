import type { CharacterPlugin } from "./types.js";
import { dealTroubleBrewingRoles } from "./trouble-brewing/deal.js";
import { troubleBrewingRoles } from "./trouble-brewing/roles.js";

export * from "./types.js";
export * from "./trouble-brewing/index.js";

export const defaultRoles: CharacterPlugin[] = troubleBrewingRoles.map((role) => ({
  id: role.id,
  name: role.name,
  type: role.type,
  team: role.team,
  ability: role.ability,
}));

const roleMap = new Map(defaultRoles.map((role) => [role.id, role]));

export function getRoleCatalog(): CharacterPlugin[] {
  return defaultRoles;
}

export function getRoleById(id: string): CharacterPlugin | undefined {
  return roleMap.get(id);
}

export function formatRoleName(roleId: string): string {
  return getRoleById(roleId)?.name ?? roleId;
}

export function dealRoles(playerCount: number): string[] {
  return dealTroubleBrewingRoles(playerCount);
}

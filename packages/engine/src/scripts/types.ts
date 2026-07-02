import type { RoleType } from "../plugins/trouble-brewing/roles.js";
import type { Team } from "../plugins/types.js";

export const StandardEdition = {
  TB: "tb",
  BMR: "bmr",
  SNV: "snv",
} as const;

export type StandardEdition = (typeof StandardEdition)[keyof typeof StandardEdition];

export type ScriptSource = StandardEdition | "custom";

export interface ScriptRole {
  id: string;
  name: string;
  type: RoleType;
  team: Team;
  ability: string;
}

export interface GameScript {
  name: string;
  source: ScriptSource;
  scriptUrl?: string;
  roles: ScriptRole[];
}

import type { Team } from "../types.js";

export type RoleType = "townsfolk" | "outsider" | "minion" | "demon";

export interface RoleDefinition {
  id: string;
  name: string;
  type: RoleType;
  team: Team;
  ability: string;
  firstNight?: boolean;
  otherNight?: boolean;
}

export const troubleBrewingRoles: RoleDefinition[] = [
  // Townsfolk
  { id: "washerwoman", name: "Washerwoman", type: "townsfolk", team: "good", ability: "Learn a Townsfolk is on the script.", firstNight: true },
  { id: "librarian", name: "Librarian", type: "townsfolk", team: "good", ability: "Learn an Outsider is on the script.", firstNight: true },
  { id: "investigator", name: "Investigator", type: "townsfolk", team: "good", ability: "Learn a Minion is on the script.", firstNight: true },
  { id: "chef", name: "Chef", type: "townsfolk", team: "good", ability: "Learn how many pairs of evil neighbors there are.", firstNight: true },
  { id: "empath", name: "Empath", type: "townsfolk", team: "good", ability: "Learn how many of your alive neighbors are evil.", otherNight: true },
  { id: "fortune_teller", name: "Fortune Teller", type: "townsfolk", team: "good", ability: "Choose two players; learn if either is the Demon.", otherNight: true },
  { id: "undertaker", name: "Undertaker", type: "townsfolk", team: "good", ability: "Learn the executed player's character.", otherNight: true },
  { id: "monk", name: "Monk", type: "townsfolk", team: "good", ability: "Choose a player; they are safe from the Demon tonight.", otherNight: true },
  { id: "ravenkeeper", name: "Ravenkeeper", type: "townsfolk", team: "good", ability: "If you die at night, choose a player to learn their character." },
  { id: "virgin", name: "Virgin", type: "townsfolk", team: "good", ability: "The first time you are nominated, the nominator is executed." },
  { id: "slayer", name: "Slayer", type: "townsfolk", team: "good", ability: "Once per game, publicly choose a player to kill; if they are the Demon, they die." },
  { id: "soldier", name: "Soldier", type: "townsfolk", team: "good", ability: "You are safe from the Demon." },
  { id: "mayor", name: "Mayor", type: "townsfolk", team: "good", ability: "If only 3 players live and no execution occurs, your team wins." },
  // Outsiders
  { id: "butler", name: "Butler", type: "outsider", team: "good", ability: "Each night, choose a player; tomorrow you may only vote if they vote." },
  { id: "drunk", name: "Drunk", type: "outsider", team: "good", ability: "You think you are a Townsfolk, but you are drunk and get false info." },
  { id: "recluse", name: "Recluse", type: "outsider", team: "good", ability: "You might register as evil to info roles." },
  { id: "saint", name: "Saint", type: "outsider", team: "good", ability: "If you die by execution, evil wins." },
  // Minions
  { id: "poisoner", name: "Poisoner", type: "minion", team: "evil", ability: "Each night, poison a player; they get false info and lose abilities.", otherNight: true },
  { id: "spy", name: "Spy", type: "minion", team: "evil", ability: "You see the Grimoire and register as good to info roles.", firstNight: true, otherNight: true },
  { id: "scarlet_woman", name: "Scarlet Woman", type: "minion", team: "evil", ability: "If there are 5+ players and the Demon dies, you become the Demon." },
  { id: "baron", name: "Baron", type: "minion", team: "evil", ability: "Setup: add 2 Outsiders and remove 2 Townsfolk." },
  // Demon
  { id: "imp", name: "Imp", type: "demon", team: "evil", ability: "Each night, kill a player. Minions you kill might become the Imp.", otherNight: true },
];

export const troubleBrewingRoleMap = new Map(troubleBrewingRoles.map((role) => [role.id, role]));

export function getTroubleBrewingRole(id: string): RoleDefinition | undefined {
  return troubleBrewingRoleMap.get(id);
}

export function getRolesByType(type: RoleType): RoleDefinition[] {
  return troubleBrewingRoles.filter((role) => role.type === type);
}

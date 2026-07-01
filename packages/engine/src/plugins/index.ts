export type Team = "good" | "evil" | "traveler";

export interface NightContext {
  gameId: string;
  nightNumber: number;
  playerId: string;
  alivePlayerIds: string[];
}

export interface NightResult {
  messages: string[];
}

export interface CharacterPlugin {
  id: string;
  name: string;
  team: Team;
  onNight?(ctx: NightContext): NightResult | void;
}

export const washerwoman: CharacterPlugin = {
  id: "washerwoman",
  name: "Washerwoman",
  team: "good",
  onNight(ctx) {
    const others = ctx.alivePlayerIds.filter((id) => id !== ctx.playerId);
    const pick = pickRandom(others);
    return {
      messages: [
        `Washerwoman learns that ${pick ?? "someone"} is a Townsfolk or Outsider.`,
      ],
    };
  },
};

export const imp: CharacterPlugin = {
  id: "imp",
  name: "Imp",
  team: "evil",
  onNight() {
    return {
      messages: ["Imp chooses a player to kill tonight."],
    };
  },
};

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

export const defaultRoles: CharacterPlugin[] = [washerwoman, imp];

export function getRoleCatalog(): CharacterPlugin[] {
  return defaultRoles;
}

export function dealRoles(playerCount: number): string[] {
  const roles: string[] = [];
  const impCount = Math.max(1, Math.floor(playerCount / 7));
  const washerCount = Math.max(1, playerCount - impCount - 2);

  for (let i = 0; i < impCount; i++) roles.push("imp");
  for (let i = 0; i < washerCount; i++) roles.push("washerwoman");
  while (roles.length < playerCount) roles.push("washerwoman");

  return shuffle(roles).slice(0, playerCount);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

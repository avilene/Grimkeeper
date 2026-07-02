import type { RoleType } from "./trouble-brewing/roles.js";

export type Team = "good" | "evil" | "traveler";

export type { RoleType };

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
  type: RoleType;
  team: Team;
  ability: string;
  onNight?(ctx: NightContext): NightResult | void;
}

export const FAKE_PLAYER_PREFIX = "dev:";

export function isFakePlayer(discordUserId: string): boolean {
  return discordUserId.startsWith(FAKE_PLAYER_PREFIX);
}

export function fakePlayerId(gameId: string, index: number): string {
  return `${FAKE_PLAYER_PREFIX}${gameId}:${index}`;
}

export function fakePlayerName(index: number): string {
  return `Dev Player ${index}`;
}

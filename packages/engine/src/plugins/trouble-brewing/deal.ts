import type { RoleType } from "./roles.js";
import { getRolesByType } from "./roles.js";

/** Official Trouble Brewing role counts (before Baron adjustments). */
const compositionByPlayerCount: Record<number, Record<RoleType, number>> = {
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

/** Reduced compositions for local dev testing (3–4 players). */
const devCompositionByPlayerCount: Record<number, Record<RoleType, number>> = {
  3: { townsfolk: 1, outsider: 0, minion: 1, demon: 1 },
  4: { townsfolk: 2, outsider: 0, minion: 1, demon: 1 },
};

export function getTroubleBrewingComposition(
  playerCount: number,
  options?: { devMode?: boolean },
): Record<RoleType, number> {
  if (options?.devMode && playerCount < 5) {
    const dev = devCompositionByPlayerCount[playerCount];
    if (!dev) {
      throw new Error(`Dev mode supports 3–4 players for quick tests, got ${playerCount}.`);
    }
    return { ...dev };
  }
  if (playerCount < 5 || playerCount > 15) {
    throw new Error(`Trouble Brewing supports 5–15 players, got ${playerCount}.`);
  }
  return { ...compositionByPlayerCount[playerCount]! };
}

export function dealTroubleBrewingRoles(
  playerCount: number,
  options?: { devMode?: boolean },
): string[] {
  const composition = getTroubleBrewingComposition(playerCount, options);
  const roleIds: string[] = [];

  for (const type of ["demon", "minion", "outsider", "townsfolk"] as RoleType[]) {
    const pool = getRolesByType(type);
    const count = composition[type];
    const picked = pickUnique(pool.map((role) => role.id), count);
    roleIds.push(...picked);
  }

  return shuffle(roleIds);
}

function pickUnique(pool: string[], count: number): string[] {
  const copy = shuffle([...pool]);
  if (count > copy.length) {
    throw new Error(`Not enough roles in pool to pick ${count}.`);
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

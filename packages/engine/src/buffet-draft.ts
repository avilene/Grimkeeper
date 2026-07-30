import type { RoleType } from "./plugins/trouble-brewing/roles.js";
import { getTroubleBrewingComposition } from "./plugins/trouble-brewing/deal.js";
import { listBotcRoles } from "./scripts/botc-catalog.js";

export type BuffetScriptPreset = "all" | "tb" | "bmr" | "snv";

export interface BuffetDraftConfig {
  enabledRoleIds: string[];
  recycleUnchosen: boolean;
  /** Steps for mulligan offers: default [3, 2, 1]. */
  mulliganSteps: number[];
  scriptPreset: BuffetScriptPreset;
}

export interface BuffetCurrentOffer {
  playerId: string;
  roleIds: string[];
  /** Index into config.mulliganSteps — 0 = first offer (3 choices). */
  mulliganStep: number;
}

export type BuffetDraftStatus = "idle" | "active" | "complete";

export interface BuffetDraftState {
  status: BuffetDraftStatus;
  config: BuffetDraftConfig;
  pool: string[];
  remainingSlots: Record<RoleType, number>;
  /** Player ids in random draft order (shuffled once at start). */
  draftOrder: string[];
  currentIndex: number;
  currentOffer: BuffetCurrentOffer | null;
  mulligansUsed: Record<string, number>;
  /** Completed picks: playerId → roleId */
  picks: Record<string, string>;
}

export function defaultBuffetConfig(): BuffetDraftConfig {
  return {
    enabledRoleIds: listBotcRoles()
      .filter((r) => r.team !== "traveler")
      .map((r) => r.id),
    recycleUnchosen: true,
    mulliganSteps: [3, 2, 1],
    scriptPreset: "all",
  };
}

export function buildInitialPool(enabledRoleIds: string[]): string[] {
  const catalogIds = new Set(listBotcRoles().map((r) => r.id));
  return enabledRoleIds.filter((id) => catalogIds.has(id));
}

export function computeRemainingSlots(
  playerCount: number,
  devMode = false,
): Record<RoleType, number> {
  return getTroubleBrewingComposition(playerCount, { devMode });
}

export function validatePoolForComposition(
  pool: string[],
  slots: Record<RoleType, number>,
): string | null {
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const countsByType: Record<string, number> = {};
  for (const id of pool) {
    const role = catalog.get(id);
    if (!role) continue;
    countsByType[role.team] = (countsByType[role.team] ?? 0) + 1;
  }
  for (const [type, needed] of Object.entries(slots)) {
    const have = countsByType[type] ?? 0;
    if (have < needed) {
      return `Not enough ${type} roles in pool: need ${needed}, have ${have}.`;
    }
  }
  return null;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Draw N role ids for the current player from the pool.
 * Roles are drawn only from types still needed (remainingSlots > 0).
 */
export function drawOffer(
  pool: string[],
  remainingSlots: Record<RoleType, number>,
  count: number,
): string[] {
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const eligible = pool.filter((id) => {
    const role = catalog.get(id);
    if (!role) return false;
    return (remainingSlots[role.team as RoleType] ?? 0) > 0;
  });
  if (eligible.length === 0) return [];
  const shuffled = shuffle(eligible);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Apply a pick to the draft state (pure — returns new state).
 */
export function applyPick(
  state: BuffetDraftState,
  playerId: string,
  roleId: string,
): BuffetDraftState {
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const role = catalog.get(roleId);
  if (!role) throw new Error(`Unknown role: ${roleId}`);

  const offer = state.currentOffer;
  if (!offer || offer.playerId !== playerId) {
    throw new Error("No active offer for this player.");
  }
  if (!offer.roleIds.includes(roleId)) {
    throw new Error("Role was not in the offer.");
  }

  const newPool = state.config.recycleUnchosen
    ? state.pool.filter((id) => id !== roleId)
    : state.pool.filter((id) => !offer.roleIds.includes(id));

  const newSlots = { ...state.remainingSlots };
  newSlots[role.team as RoleType] = Math.max(0, (newSlots[role.team as RoleType] ?? 0) - 1);

  const newPicks = { ...state.picks, [playerId]: roleId };
  const newIndex = state.currentIndex + 1;
  const isComplete = newIndex >= state.draftOrder.length;

  return {
    ...state,
    pool: newPool,
    remainingSlots: newSlots,
    currentIndex: newIndex,
    currentOffer: null,
    picks: newPicks,
    status: isComplete ? "complete" : "active",
    mulligansUsed: { ...state.mulligansUsed },
  };
}

/**
 * Apply a mulligan (pure — returns new state with new offer).
 * Throws if no more mulligan steps available.
 */
export function applyMulligan(
  state: BuffetDraftState,
  playerId: string,
): { state: BuffetDraftState; newOffer: string[] } {
  const offer = state.currentOffer;
  if (!offer || offer.playerId !== playerId) {
    throw new Error("No active offer for this player.");
  }
  const nextStep = offer.mulliganStep + 1;
  const steps = state.config.mulliganSteps;
  if (nextStep >= steps.length) {
    throw new Error("No more mulligans available.");
  }

  const newCount = steps[nextStep]!;
  const newOfferIds = drawOffer(state.pool, state.remainingSlots, newCount);

  const newOffer: BuffetCurrentOffer = {
    playerId,
    roleIds: newOfferIds,
    mulliganStep: nextStep,
  };

  const newMulligansUsed = {
    ...state.mulligansUsed,
    [playerId]: (state.mulligansUsed[playerId] ?? 0) + 1,
  };

  return {
    state: { ...state, currentOffer: newOffer, mulligansUsed: newMulligansUsed },
    newOffer: newOfferIds,
  };
}

/**
 * Build the next offer message for the player at currentIndex.
 */
export function buildNextOffer(state: BuffetDraftState): BuffetCurrentOffer | null {
  if (state.currentIndex >= state.draftOrder.length) return null;
  const playerId = state.draftOrder[state.currentIndex]!;
  const count = state.config.mulliganSteps[0] ?? 3;
  const roleIds = drawOffer(state.pool, state.remainingSlots, count);
  return { playerId, roleIds, mulliganStep: 0 };
}

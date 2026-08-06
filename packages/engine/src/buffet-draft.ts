import type { RoleType } from "./plugins/trouble-brewing/roles.js";
import { getTroubleBrewingComposition } from "./plugins/trouble-brewing/deal.js";
import { listBotcRoles } from "./scripts/botc-catalog.js";

export type BuffetScriptPreset = "all" | "tb" | "bmr" | "snv";

/** Roles players never click — assigned behind the scenes or by the ST. */
export const BUFFET_SECRET_ROLES = ["lunatic", "marionette", "drunk", "hermit"] as const;
export type BuffetSecretRole = (typeof BUFFET_SECRET_ROLES)[number];

/**
 * Excluded from the default enabled pool (ST can still turn them on in admin).
 * Marionette / Lunatic / Hermit are never player-pickable either.
 */
export const BUFFET_HIDDEN_BY_DEFAULT = ["hermit", "marionette", "lunatic"] as const;

export type BuffetOfferKind = "standard" | "lilmonsta-minion";

/**
 * Outsider-count setup modifiers applied when the role is drafted.
 * Values are candidate deltas (outsider += delta, townsfolk -= delta).
 * Multi-option entries are chosen at pick time and stored on the event for replay.
 */
export const OUTSIDER_SETUP_DELTAS: Record<string, number[]> = {
  baron: [2],
  fanggu: [1],
  vigormortis: [-1],
  /** Official Balloonist is [+0 or +1 Outsider]. */
  balloonist: [0, 1],
  godfather: [-1, 1],
};

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
  /**
   * `lilmonsta-minion`: follow-up after picking Lil' Monsta — player chooses
   * which Minion they actually are (Lil' Monsta is not a player).
   */
  offerKind?: BuffetOfferKind;
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
  /** Completed picks: playerId → true roleId (secret roles for pretenders). */
  picks: Record<string, string>;
  /**
   * Players secretly assigned Drunk / Lunatic / Marionette at draft start.
   * They still “pick”, but see townsfolk / demon / townsfolk offers and keep a belief.
   */
  secretAssignments: Record<string, BuffetSecretRole>;
  /** What pretenders think they are (clicked role). */
  beliefs: Record<string, string>;
  /**
   * Non-player demon in play (Lil' Monsta). Set when someone drafts Lil' Monsta;
   * that player then picks a Minion as their real role.
   */
  inPlayDemon: string | null;
}

export interface BuffetPickOptions {
  /** Outsider delta applied with this pick (for setup roles). Stored on the event. */
  outsiderAdjustment?: number;
}

export interface SeatPair {
  playerId: string;
  seat: number;
}

export function defaultBuffetConfig(): BuffetDraftConfig {
  const hidden = new Set<string>(BUFFET_HIDDEN_BY_DEFAULT);
  return {
    enabledRoleIds: listBotcRoles()
      .filter((r) => r.team !== "traveler" && !hidden.has(r.id))
      .map((r) => r.id),
    recycleUnchosen: true,
    mulliganSteps: [3, 2, 1],
    scriptPreset: "all",
  };
}

export function isBuffetSecretRole(roleId: string): roleId is BuffetSecretRole {
  return (BUFFET_SECRET_ROLES as readonly string[]).includes(roleId);
}

export function buildInitialPool(enabledRoleIds: string[]): string[] {
  const catalogIds = new Set(listBotcRoles().map((r) => r.id));
  return enabledRoleIds.filter((id) => catalogIds.has(id));
}

/** Pool roles players can actually click — excludes Drunk / Hermit / Lunatic / Marionette. */
export function buildPickablePool(enabledRoleIds: string[]): string[] {
  return buildInitialPool(enabledRoleIds).filter((id) => !isBuffetSecretRole(id));
}

/**
 * Summoner setup: [No Demon] — if Summoner is enabled, there is no demon in the bag
 * from the start (demon slots become townsfolk).
 */
export function applySummonerNoDemonSetup(
  slots: Record<RoleType, number>,
  enabledRoleIds: string[],
): Record<RoleType, number> {
  if (!enabledRoleIds.includes("summoner")) return { ...slots };
  const demons = slots.demon ?? 0;
  if (demons <= 0) return { ...slots };
  return {
    ...slots,
    demon: 0,
    townsfolk: (slots.townsfolk ?? 0) + demons,
  };
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

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function roleTeam(roleId: string): RoleType | null {
  const role = listBotcRoles().find((r) => r.id === roleId);
  if (!role || role.team === "traveler") return null;
  return role.team as RoleType;
}

/**
 * Choose an outsider delta for a drafted setup role.
 * For multi-option roles (Godfather, Balloonist), picks a legal option at random.
 */
export function chooseOutsiderAdjustment(
  roleId: string,
  currentOutsiderSlots: number,
  rng: () => number = Math.random,
): number {
  const options = OUTSIDER_SETUP_DELTAS[roleId];
  if (!options || options.length === 0) return 0;

  const legal = options.filter((delta) => currentOutsiderSlots + delta >= 0);
  const pool = legal.length > 0 ? legal : [0];
  const index = Math.floor(rng() * pool.length);
  return pool[index] ?? 0;
}

/** Apply outsider ↔ townsfolk swap; clamps outsider at 0. */
export function applyOutsiderAdjustment(
  slots: Record<RoleType, number>,
  delta: number,
): Record<RoleType, number> {
  if (delta === 0) return { ...slots };
  const next = { ...slots };
  const rawOutsider = (next.outsider ?? 0) + delta;
  const newOutsider = Math.max(0, rawOutsider);
  const actualDelta = newOutsider - (next.outsider ?? 0);
  next.outsider = newOutsider;
  next.townsfolk = Math.max(0, (next.townsfolk ?? 0) - actualDelta);
  return next;
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
    if (isBuffetSecretRole(id)) return false;
    const role = catalog.get(id);
    if (!role || role.team === "traveler") return false;
    return (remainingSlots[role.team as RoleType] ?? 0) > 0;
  });
  if (eligible.length === 0) return [];
  const shuffled = shuffle(eligible);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Draw N roles of a forced team (for pretender belief offers). */
export function drawOfferByTeam(pool: string[], team: RoleType, count: number): string[] {
  const eligible = pool.filter((id) => !isBuffetSecretRole(id) && roleTeam(id) === team);
  if (eligible.length === 0) return [];
  const shuffled = shuffle(eligible);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Decide secret Lunatic / Marionette assignments for this draft.
 * Drunk is never auto-assigned — the ST picks who is Drunk when outsider mods need it.
 * Forces assignment when pickable roles alone cannot fill a team slot;
 * otherwise includes them with probability ≈ K / N (dealt into the rack).
 */
export function assignSecretRoles(
  enabledRoleIds: string[],
  slots: Record<RoleType, number>,
  draftOrder: string[],
  rng: () => number = Math.random,
): {
  secretAssignments: Record<string, BuffetSecretRole>;
  remainingSlots: Record<RoleType, number>;
} {
  const enabled = new Set(enabledRoleIds);
  const remainingSlots = { ...slots };
  const secretAssignments: Record<string, BuffetSecretRole> = {};
  const availablePlayers = shuffle([...draftOrder], rng);
  const pickable = buildPickablePool(enabledRoleIds);

  const pickableCount = (team: RoleType) =>
    pickable.filter((id) => roleTeam(id) === team).length;

  const assign = (roleId: BuffetSecretRole, team: RoleType) => {
    if (Object.values(secretAssignments).includes(roleId)) return;
    if (!enabled.has(roleId)) return;
    if ((remainingSlots[team] ?? 0) <= 0) return;
    const playerId = availablePlayers.find((id) => !secretAssignments[id]);
    if (!playerId) return;
    secretAssignments[playerId] = roleId;
    remainingSlots[team] = Math.max(0, (remainingSlots[team] ?? 0) - 1);
  };

  // Force when pickable pool cannot cover the team slot without secret roles.
  if (
    enabled.has("lunatic") &&
    (remainingSlots.outsider ?? 0) > pickableCount("outsider")
  ) {
    assign("lunatic", "outsider");
  }
  if (
    enabled.has("marionette") &&
    (remainingSlots.minion ?? 0) > pickableCount("minion")
  ) {
    assign("marionette", "minion");
  }

  const tryProbabilistic = (roleId: BuffetSecretRole, team: RoleType) => {
    if (Object.values(secretAssignments).includes(roleId)) return;
    if (!enabled.has(roleId)) return;
    if ((remainingSlots[team] ?? 0) <= 0) return;

    const teamPoolSize = buildInitialPool(enabledRoleIds).filter(
      (id) => roleTeam(id) === team,
    ).length;
    if (teamPoolSize <= 0) return;

    const p = Math.min(1, (remainingSlots[team] ?? 0) / teamPoolSize);
    if (rng() >= p) return;
    assign(roleId, team);
  };

  tryProbabilistic("lunatic", "outsider");
  tryProbabilistic("marionette", "minion");

  return { secretAssignments, remainingSlots };
}

/**
 * Whether the ST should consider assigning Drunk after outsider mods.
 * Returns `null` when Drunk is not in the buffet selector — do not mention Drunk.
 * Otherwise returns whether Drunk is still needed to cover unfilled outsider slots.
 */
export function describeBuffetDrunkFix(state: BuffetDraftState): {
  needed: boolean;
  unfilledOutsiders: number;
} | null {
  if (!state.config.enabledRoleIds.includes("drunk")) return null;
  const drunkAssigned =
    Object.values(state.secretAssignments).includes("drunk") ||
    Object.values(state.picks).includes("drunk");
  const unfilledOutsiders = Math.max(0, state.remainingSlots.outsider ?? 0);
  return {
    needed: !drunkAssigned && unfilledOutsiders > 0,
    unfilledOutsiders,
  };
}

/** Discord/kib copy for {@link describeBuffetDrunkFix}; null when Drunk is not enabled. */
export function formatBuffetDrunkFixLine(state: BuffetDraftState): string | null {
  const fix = describeBuffetDrunkFix(state);
  if (!fix) return null;
  if (!fix.needed) {
    return "Outsider count looks filled — no Drunk needed.";
  }
  const n = fix.unfilledOutsiders;
  const slots = n === 1 ? "1 unfilled outsider slot" : `${n} unfilled outsider slots`;
  return `Need Drunk to fix the count (${slots}). Use \`/st do buffet-assign-drunk player:@…\`.`;
}

/**
 * ST assigns Drunk to a player (for outsider-count setups).
 * Unpicked players get townsfolk belief offers on their turn.
 * Players who already picked a Townsfolk are converted (belief = former pick).
 */
export function applyAssignDrunk(
  state: BuffetDraftState,
  playerId: string,
): BuffetDraftState {
  if (!state.draftOrder.includes(playerId)) {
    throw new Error("That player is not in this draft.");
  }
  if (state.secretAssignments[playerId]) {
    throw new Error("That player already has a secret assignment.");
  }
  if (Object.values(state.secretAssignments).includes("drunk")) {
    throw new Error("Drunk is already assigned to another player.");
  }
  if (Object.values(state.picks).includes("drunk")) {
    throw new Error("Drunk is already assigned.");
  }

  const existingPick = state.picks[playerId];
  if (existingPick) {
    const team = roleTeam(existingPick);
    if (team !== "townsfolk") {
      throw new Error("Can only convert a Townsfolk pick into Drunk.");
    }
    if ((state.remainingSlots.outsider ?? 0) < 1) {
      throw new Error("No outsider slots left to assign Drunk.");
    }
    return {
      ...state,
      remainingSlots: {
        ...state.remainingSlots,
        townsfolk: (state.remainingSlots.townsfolk ?? 0) + 1,
        outsider: (state.remainingSlots.outsider ?? 0) - 1,
      },
      picks: { ...state.picks, [playerId]: "drunk" },
      beliefs: { ...state.beliefs, [playerId]: existingPick },
      secretAssignments: { ...state.secretAssignments, [playerId]: "drunk" },
      // Clear offer if this was somehow the current drafter mid-pick (shouldn't happen).
      currentOffer:
        state.currentOffer?.playerId === playerId ? null : state.currentOffer,
    };
  }

  if (state.status === "complete") {
    throw new Error("After the draft, Drunk can only convert a Townsfolk pick.");
  }

  if ((state.remainingSlots.outsider ?? 0) < 1) {
    throw new Error("No outsider slots left to assign Drunk.");
  }

  return {
    ...state,
    remainingSlots: {
      ...state.remainingSlots,
      outsider: (state.remainingSlots.outsider ?? 0) - 1,
    },
    secretAssignments: { ...state.secretAssignments, [playerId]: "drunk" },
    // If it's their turn, clear the offer so the engine can rebuild townsfolk choices.
    currentOffer:
      state.currentOffer?.playerId === playerId ? null : state.currentOffer,
  };
}

function drawOfferForPlayer(
  state: BuffetDraftState,
  playerId: string,
  count: number,
  offerKind: BuffetOfferKind = "standard",
): string[] {
  if (offerKind === "lilmonsta-minion") {
    return drawOfferByTeam(state.pool, "minion", count);
  }
  const secret = state.secretAssignments[playerId];
  if (secret === "lunatic") {
    return drawOfferByTeam(state.pool, "demon", count);
  }
  if (secret === "marionette" || secret === "drunk") {
    return drawOfferByTeam(state.pool, "townsfolk", count);
  }
  return drawOffer(state.pool, state.remainingSlots, count);
}

/** Follow-up offer after someone drafts Lil' Monsta. */
export function buildLilMonstaMinionOffer(
  state: BuffetDraftState,
  playerId: string,
): BuffetCurrentOffer {
  const count = state.config.mulliganSteps[0] ?? 3;
  return {
    playerId,
    roleIds: drawOfferByTeam(state.pool, "minion", count),
    mulliganStep: 0,
    offerKind: "lilmonsta-minion",
  };
}

/**
 * Apply a pick to the draft state (pure — returns new state).
 * `roleId` is the role the player clicked (belief for pretenders).
 */
export function applyPick(
  state: BuffetDraftState,
  playerId: string,
  roleId: string,
  options?: BuffetPickOptions,
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

  const offerKind = offer.offerKind ?? "standard";

  // Lil' Monsta: not a player — consume demon slot, +1 minion, then same player picks a Minion.
  if (roleId === "lilmonsta" && offerKind === "standard") {
    const newPool = state.config.recycleUnchosen
      ? state.pool.filter((id) => id !== roleId)
      : state.pool.filter((id) => !offer.roleIds.includes(id));
    const newSlots: Record<RoleType, number> = {
      ...state.remainingSlots,
      demon: Math.max(0, (state.remainingSlots.demon ?? 0) - 1),
      minion: (state.remainingSlots.minion ?? 0) + 1,
    };
    return {
      ...state,
      pool: newPool,
      remainingSlots: newSlots,
      currentOffer: null,
      inPlayDemon: "lilmonsta",
      // Do not advance index or record a pick — follow-up minion offer comes next.
    };
  }

  const secret = state.secretAssignments[playerId];
  const trueRoleId = secret ?? roleId;
  const isPretender = Boolean(secret);

  let newPool: string[];
  if (isPretender) {
    // Belief pick does not remove the clicked role (real role may still be dealt).
    newPool = state.config.recycleUnchosen
      ? [...state.pool]
      : state.pool.filter((id) => id === roleId || !offer.roleIds.includes(id));
  } else {
    newPool = state.config.recycleUnchosen
      ? state.pool.filter((id) => id !== roleId)
      : state.pool.filter((id) => !offer.roleIds.includes(id));
  }

  let newSlots = { ...state.remainingSlots };
  if (!isPretender) {
    // Secret roles already reserved their true slot at draft start.
    newSlots[role.team as RoleType] = Math.max(0, (newSlots[role.team as RoleType] ?? 0) - 1);
    const adjustment = options?.outsiderAdjustment ?? 0;
    if (adjustment !== 0) {
      newSlots = applyOutsiderAdjustment(newSlots, adjustment);
    }
  }

  const newPicks = { ...state.picks, [playerId]: trueRoleId };
  const newBeliefs = { ...state.beliefs };
  if (isPretender) {
    newBeliefs[playerId] = roleId;
  }

  const newIndex = state.currentIndex + 1;
  const isComplete = newIndex >= state.draftOrder.length;

  return {
    ...state,
    pool: newPool,
    remainingSlots: newSlots,
    currentIndex: newIndex,
    currentOffer: null,
    picks: newPicks,
    beliefs: newBeliefs,
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
  const offerKind = offer.offerKind ?? "standard";
  const newOfferIds = drawOfferForPlayer(state, playerId, newCount, offerKind);

  const newOffer: BuffetCurrentOffer = {
    playerId,
    roleIds: newOfferIds,
    mulliganStep: nextStep,
    offerKind,
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
  const roleIds = drawOfferForPlayer(state, playerId, count);
  return { playerId, roleIds, mulliganStep: 0, offerKind: "standard" };
}

/** True if two seats are neighbors on a circle of `seatCount` (1-indexed seats). */
export function seatsAreNeighbors(
  seatA: number,
  seatB: number,
  seatCount: number,
): boolean {
  if (seatCount < 2) return false;
  const diff = Math.abs(seatA - seatB);
  return diff === 1 || diff === seatCount - 1;
}

/**
 * After draft, ensure the Marionette sits next to a Demon by swapping seats if needed.
 * Returns seat updates to emit (empty if already adjacent, missing roles, or Lil' Monsta).
 */
export function planMarionetteSeatSwaps(
  players: Array<{ id: string; seat: number | null }>,
  picks: Record<string, string>,
  inPlayDemon?: string | null,
): SeatPair[] {
  // Lil' Monsta has no player Demon — seating is handled in-play by babysitting.
  if (inPlayDemon === "lilmonsta") return [];

  const marionetteId = Object.entries(picks).find(([, role]) => role === "marionette")?.[0];
  if (!marionetteId) return [];

  const demonIds = Object.entries(picks)
    .filter(([, role]) => roleTeam(role) === "demon")
    .map(([id]) => id);
  if (demonIds.length === 0) return [];

  const seated = players.filter((p) => p.seat != null) as Array<{ id: string; seat: number }>;
  const seatCount = seated.length;
  const byId = new Map(seated.map((p) => [p.id, p]));

  const marionette = byId.get(marionetteId);
  if (!marionette) return [];

  const alreadyNextToDemon = demonIds.some((demonId) => {
    const demon = byId.get(demonId);
    return demon ? seatsAreNeighbors(marionette.seat, demon.seat, seatCount) : false;
  });
  if (alreadyNextToDemon) return [];

  // Prefer swapping with a non-demon neighbour of the first demon.
  const primaryDemon = byId.get(demonIds[0]!);
  if (!primaryDemon) return [];

  const neighborSeats = [
    primaryDemon.seat === 1 ? seatCount : primaryDemon.seat - 1,
    primaryDemon.seat === seatCount ? 1 : primaryDemon.seat + 1,
  ];

  for (const neighborSeat of neighborSeats) {
    const neighbor = seated.find((p) => p.seat === neighborSeat);
    if (!neighbor) continue;
    if (demonIds.includes(neighbor.id)) continue;
    if (neighbor.id === marionetteId) continue;

    return [
      { playerId: marionetteId, seat: neighbor.seat },
      { playerId: neighbor.id, seat: marionette.seat },
    ];
  }

  return [];
}

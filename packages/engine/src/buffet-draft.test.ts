import { describe, expect, it } from "vitest";
import {
  defaultBuffetConfig,
  buildInitialPool,
  buildPickablePool,
  computeRemainingSlots,
  validatePoolForComposition,
  drawOffer,
  drawOfferByTeam,
  applyPick,
  applyMulligan,
  applyOutsiderAdjustment,
  applySummonerNoDemonSetup,
  applyAssignDrunk,
  chooseOutsiderAdjustment,
  assignSecretRoles,
  describeBuffetDrunkFix,
  formatBuffetDrunkFixLine,
  formatHermitUnchosenOutsidersLine,
  listUnchosenOutsidersForHermit,
  applyAssignLunatic,
  buildLilMonstaMinionOffer,
  buildNextOffer,
  planMarionetteSeatSwaps,
  seatsAreNeighbors,
  shuffle,
  OUTSIDER_SETUP_DELTAS,
  type BuffetDraftState,
} from "./buffet-draft.js";
import { listBotcRoles } from "./scripts/botc-catalog.js";
import {
  GameEngine,
  GameCommandKind,
  GameEventType,
  fakePlayerId,
  fakePlayerName,
  type GameEvent,
} from "./index.js";

const gameId = "game-buffet-1";

function emptySecrets(): Pick<
  BuffetDraftState,
  "secretAssignments" | "beliefs" | "inPlayDemon"
> {
  return { secretAssignments: {}, beliefs: {}, inPlayDemon: null };
}

function setupTownEvents(playerCount: number, options?: { fake?: boolean }): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: GameEventType.GameCreated,
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
      timestamp: new Date().toISOString(),
    },
    {
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: Array.from({ length: playerCount }, (_, i) => ({
        playerId: `player-${i + 1}`,
        discordUserId: options?.fake
          ? fakePlayerId(gameId, i + 1)
          : `user-${i + 1}`,
        displayName: options?.fake ? fakePlayerName(i + 1) : `Player ${i + 1}`,
        seat: i + 1,
      })),
      timestamp: new Date().toISOString(),
    },
  ];
  return events;
}

function engineWithTown(playerCount: number, options?: { fake?: boolean }): GameEngine {
  const engine = new GameEngine(gameId);
  for (const event of setupTownEvents(playerCount, options)) {
    engine.apply(event);
  }
  return engine;
}

describe("defaultBuffetConfig", () => {
  it("includes most non-traveler roles but hides marionette/lunatic", () => {
    const config = defaultBuffetConfig();
    expect(config.enabledRoleIds.length).toBeGreaterThan(100);
    expect(config.recycleUnchosen).toBe(true);
    expect(config.mulliganSteps).toEqual([3, 2, 1]);
    expect(config.scriptPreset).toBe("all");
    expect(config.enabledRoleIds).toContain("hermit");
    expect(config.enabledRoleIds).not.toContain("marionette");
    expect(config.enabledRoleIds).not.toContain("lunatic");
    expect(config.enabledRoleIds).toContain("drunk");
  });
});

describe("buildInitialPool", () => {
  it("filters out unknown role ids", () => {
    const pool = buildInitialPool(["washerwoman", "not-a-real-role", "imp"]);
    expect(pool).toContain("washerwoman");
    expect(pool).toContain("imp");
    expect(pool).not.toContain("not-a-real-role");
  });
});

describe("buildPickablePool", () => {
  it("excludes drunk, lunatic, and marionette but allows hermit", () => {
    const pool = buildPickablePool([
      "washerwoman",
      "drunk",
      "hermit",
      "lunatic",
      "marionette",
      "imp",
    ]);
    expect(pool).toContain("washerwoman");
    expect(pool).toContain("imp");
    expect(pool).toContain("hermit");
    expect(pool).not.toContain("drunk");
    expect(pool).not.toContain("lunatic");
    expect(pool).not.toContain("marionette");
  });
});

describe("validatePoolForComposition", () => {
  it("passes when pool has enough of each type", () => {
    const pool = buildInitialPool(defaultBuffetConfig().enabledRoleIds);
    const slots = computeRemainingSlots(7);
    expect(validatePoolForComposition(pool, slots)).toBeNull();
  });

  it("returns error when not enough demons", () => {
    const pool = buildInitialPool(
      defaultBuffetConfig().enabledRoleIds.filter((id) => id !== "imp" && id !== "zombuul"),
    );
    const error = validatePoolForComposition(pool, {
      townsfolk: 0,
      outsider: 0,
      minion: 0,
      demon: 999,
    });
    expect(error).toMatch(/demon/i);
  });
});

describe("outsider setup adjustments", () => {
  it("baron adds 2 outsiders and removes 2 townsfolk", () => {
    const next = applyOutsiderAdjustment(
      { townsfolk: 5, outsider: 0, minion: 0, demon: 1 },
      2,
    );
    expect(next.outsider).toBe(2);
    expect(next.townsfolk).toBe(3);
  });

  it("vigormortis clamps when outsider is already 0", () => {
    const next = applyOutsiderAdjustment(
      { townsfolk: 5, outsider: 0, minion: 1, demon: 0 },
      -1,
    );
    expect(next.outsider).toBe(0);
    expect(next.townsfolk).toBe(5);
  });

  it("chooseOutsiderAdjustment returns baron +2", () => {
    expect(chooseOutsiderAdjustment("baron", 0)).toBe(2);
  });

  it("chooseOutsiderAdjustment avoids illegal godfather -1 at 0 outsiders", () => {
    const delta = chooseOutsiderAdjustment("godfather", 0, () => 0);
    expect(delta).toBe(1);
  });

  it("chooseOutsiderAdjustment for hermit is 0 or -1", () => {
    expect(OUTSIDER_SETUP_DELTAS.hermit).toEqual([0, -1]);
    expect(chooseOutsiderAdjustment("hermit", 1, () => 0)).toBe(0);
    expect(chooseOutsiderAdjustment("hermit", 1, () => 0.99)).toBe(-1);
    expect(chooseOutsiderAdjustment("hermit", 0, () => 0.99)).toBe(0);
  });
});

describe("drawOffer", () => {
  it("draws N roles from eligible types only", () => {
    const pool = ["washerwoman", "librarian", "investigator", "imp", "poisoner"];
    const slots = { townsfolk: 3, outsider: 0, minion: 1, demon: 1 };
    const offer = drawOffer(pool, slots, 3);
    expect(offer).toHaveLength(3);
    for (const id of offer) {
      expect(pool).toContain(id);
    }
  });

  it("never offers outsider when outsider slot is 0", () => {
    const pool = buildInitialPool(defaultBuffetConfig().enabledRoleIds);
    const slots = { townsfolk: 5, outsider: 0, minion: 1, demon: 1 };
    const roles = listBotcRoles();
    for (let i = 0; i < 20; i++) {
      const offer = drawOffer(pool, slots, 3);
      for (const id of offer) {
        const role = roles.find((r) => r.id === id);
        expect(role?.team).not.toBe("outsider");
      }
    }
  });

  it("never offers drunk, lunatic or marionette", () => {
    const pool = buildInitialPool(defaultBuffetConfig().enabledRoleIds);
    const slots = { townsfolk: 5, outsider: 2, minion: 1, demon: 1 };
    for (let i = 0; i < 30; i++) {
      const offer = drawOffer(pool, slots, 3);
      expect(offer).not.toContain("drunk");
      expect(offer).not.toContain("lunatic");
      expect(offer).not.toContain("marionette");
    }
  });

  it("offers fewer than N when pool is small", () => {
    const offer = drawOffer(["imp"], { townsfolk: 0, outsider: 0, minion: 0, demon: 1 }, 3);
    expect(offer).toHaveLength(1);
    expect(offer[0]).toBe("imp");
  });
});

describe("drawOfferByTeam", () => {
  it("only returns the requested team", () => {
    const offer = drawOfferByTeam(
      ["washerwoman", "imp", "poisoner", "butler"],
      "demon",
      3,
    );
    expect(offer).toEqual(["imp"]);
  });
});

describe("summoner and lil monsta setup", () => {
  it("summoner removes demons from the bag at start", () => {
    const slots = applySummonerNoDemonSetup(
      { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
      ["summoner", "washerwoman", "imp"],
    );
    expect(slots.demon).toBe(0);
    expect(slots.townsfolk).toBe(6);
  });

  it("leaves slots unchanged when summoner is not enabled", () => {
    const base = { townsfolk: 5, outsider: 0, minion: 1, demon: 1 };
    expect(applySummonerNoDemonSetup(base, ["imp", "washerwoman"])).toEqual(base);
  });
});

describe("assignSecretRoles", () => {
  it("forces lunatic when pickable outsiders cannot cover slots", () => {
    const { secretAssignments, remainingSlots } = assignSecretRoles(
      ["washerwoman", "librarian", "imp", "poisoner", "lunatic"],
      { townsfolk: 2, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4", "p5"],
      () => 0.99,
    );
    expect(Object.values(secretAssignments)).toContain("lunatic");
    expect(remainingSlots.outsider).toBe(0);
  });

  it("can leave lunatic unassigned when pickable outsiders cover slots", () => {
    const { secretAssignments } = assignSecretRoles(
      ["washerwoman", "butler", "recluse", "imp", "poisoner", "lunatic"],
      { townsfolk: 1, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4"],
      () => 0.99,
    );
    expect(secretAssignments).toEqual({});
  });

  it("honors ST pre-assigned lunatic", () => {
    const { secretAssignments, remainingSlots } = assignSecretRoles(
      ["washerwoman", "librarian", "imp", "poisoner", "lunatic", "butler"],
      { townsfolk: 2, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4", "p5"],
      () => 0.99,
      { p3: "lunatic" },
    );
    expect(secretAssignments).toEqual({ p3: "lunatic" });
    expect(remainingSlots.outsider).toBe(0);
  });

  it("honors pre-assigned lunatic even when not in the buffet selector", () => {
    const { secretAssignments } = assignSecretRoles(
      ["washerwoman", "librarian", "imp", "poisoner", "butler"],
      { townsfolk: 2, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4", "p5"],
      () => 0.99,
      { p2: "lunatic" },
    );
    expect(secretAssignments).toEqual({ p2: "lunatic" });
  });

  it("never auto-assigns drunk (ST assigns via AssignBuffetDrunk)", () => {
    const { secretAssignments } = assignSecretRoles(
      ["washerwoman", "librarian", "imp", "poisoner", "drunk"],
      { townsfolk: 2, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4", "p5"],
      () => 0,
    );
    expect(Object.values(secretAssignments)).not.toContain("drunk");
    expect(secretAssignments).toEqual({});
  });

  it("does not probabilistically assign lunatic (ST pre-assigns)", () => {
    const { secretAssignments } = assignSecretRoles(
      ["washerwoman", "butler", "recluse", "imp", "poisoner", "lunatic"],
      { townsfolk: 1, outsider: 1, minion: 1, demon: 1 },
      ["p1", "p2", "p3", "p4"],
      () => 0,
    );
    expect(Object.values(secretAssignments)).not.toContain("lunatic");
  });
});

describe("applyAssignDrunk", () => {
  function makeDraft(): BuffetDraftState {
    return {
      status: "active",
      config: defaultBuffetConfig(),
      pool: ["washerwoman", "librarian", "imp", "poisoner", "butler"],
      remainingSlots: { townsfolk: 2, outsider: 1, minion: 1, demon: 1 },
      draftOrder: ["player-1", "player-2", "player-3", "player-4"],
      currentIndex: 0,
      currentOffer: null,
      mulligansUsed: {},
      picks: {},
      secretAssignments: {},
      beliefs: {},
      inPlayDemon: null,
    };
  }

  it("reserves an outsider slot for an unpicked player", () => {
    const draft = makeDraft();
    const next = applyAssignDrunk(draft, "player-2");
    expect(next.secretAssignments["player-2"]).toBe("drunk");
    expect(next.remainingSlots.outsider).toBe(0);
    expect(next.picks["player-2"]).toBeUndefined();
  });

  it("converts an existing townsfolk pick into drunk with belief", () => {
    const draft = makeDraft();
    draft.picks = { "player-1": "washerwoman" };
    draft.currentIndex = 1;
    const next = applyAssignDrunk(draft, "player-1");
    expect(next.picks["player-1"]).toBe("drunk");
    expect(next.beliefs["player-1"]).toBe("washerwoman");
    expect(next.remainingSlots.outsider).toBe(0);
    expect(next.remainingSlots.townsfolk).toBe(3);
  });

  it("rejects when no outsider slots remain", () => {
    const draft = makeDraft();
    draft.remainingSlots = { townsfolk: 2, outsider: 0, minion: 1, demon: 1 };
    expect(() => applyAssignDrunk(draft, "player-1")).toThrow(/outsider/i);
  });
});

describe("describeBuffetDrunkFix", () => {
  function makeDraft(enabled: string[]): BuffetDraftState {
    return {
      status: "complete",
      config: { ...defaultBuffetConfig(), enabledRoleIds: enabled },
      pool: [],
      remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
      draftOrder: ["player-1"],
      currentIndex: 1,
      currentOffer: null,
      mulligansUsed: {},
      picks: { "player-1": "washerwoman" },
      secretAssignments: {},
      beliefs: {},
      inPlayDemon: null,
    };
  }

  it("returns null when drunk is not in the buffet selector", () => {
    const draft = makeDraft(["washerwoman", "imp"]);
    draft.remainingSlots.outsider = 2;
    expect(describeBuffetDrunkFix(draft)).toBeNull();
    expect(formatBuffetDrunkFixLine(draft)).toBeNull();
  });

  it("says drunk is needed when outsider slots remain and drunk is enabled", () => {
    const draft = makeDraft(["washerwoman", "drunk", "imp"]);
    draft.remainingSlots.outsider = 2;
    expect(describeBuffetDrunkFix(draft)).toEqual({
      needed: true,
      unfilledOutsiders: 2,
    });
    expect(formatBuffetDrunkFixLine(draft)).toMatch(/Need Drunk/i);
  });

  it("says no drunk needed when outsider slots are filled", () => {
    const draft = makeDraft(["washerwoman", "drunk", "imp"]);
    expect(describeBuffetDrunkFix(draft)).toEqual({
      needed: false,
      unfilledOutsiders: 0,
    });
    expect(formatBuffetDrunkFixLine(draft)).toMatch(/no Drunk needed/i);
  });

  it("says no drunk needed when drunk is already assigned", () => {
    const draft = makeDraft(["washerwoman", "drunk", "imp"]);
    draft.remainingSlots.outsider = 1;
    draft.picks["player-1"] = "drunk";
    expect(describeBuffetDrunkFix(draft)?.needed).toBe(false);
  });
});

describe("listUnchosenOutsidersForHermit", () => {
  function makeDraft(): BuffetDraftState {
    return {
      status: "complete",
      config: {
        ...defaultBuffetConfig(),
        enabledRoleIds: [
          "washerwoman",
          "hermit",
          "butler",
          "recluse",
          "saint",
          "drunk",
          "imp",
        ],
      },
      pool: [],
      remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
      draftOrder: ["player-1", "player-2"],
      currentIndex: 2,
      currentOffer: null,
      mulligansUsed: {},
      picks: { "player-1": "hermit", "player-2": "imp" },
      secretAssignments: {},
      beliefs: {},
      inPlayDemon: null,
    };
  }

  it("returns enabled outsiders not taken when hermit is in play", () => {
    expect(listUnchosenOutsidersForHermit(makeDraft())).toEqual([
      "butler",
      "drunk",
      "recluse",
      "saint",
    ]);
    expect(formatHermitUnchosenOutsidersLine(makeDraft())).toMatch(/Butler/i);
  });

  it("excludes secret-assigned outsiders from the unchosen list", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-2": "drunk" };
    draft.picks = { "player-1": "hermit", "player-2": "drunk" };
    expect(listUnchosenOutsidersForHermit(draft)).not.toContain("drunk");
  });

  it("returns null copy when hermit was not picked", () => {
    const draft = makeDraft();
    draft.picks = { "player-1": "butler", "player-2": "imp" };
    expect(listUnchosenOutsidersForHermit(draft)).toEqual([]);
    expect(formatHermitUnchosenOutsidersLine(draft)).toBeNull();
  });
});

describe("applyAssignLunatic", () => {
  function makeIdle(): BuffetDraftState {
    return {
      status: "idle",
      config: {
        ...defaultBuffetConfig(),
        enabledRoleIds: [...defaultBuffetConfig().enabledRoleIds, "lunatic"],
      },
      pool: [],
      remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
      draftOrder: [],
      currentIndex: 0,
      currentOffer: null,
      mulligansUsed: {},
      picks: {},
      secretAssignments: {},
      beliefs: {},
      inPlayDemon: null,
    };
  }

  it("pre-assigns on idle draft without touching slots", () => {
    const next = applyAssignLunatic(makeIdle(), "player-1");
    expect(next.secretAssignments["player-1"]).toBe("lunatic");
    expect(next.remainingSlots.outsider).toBe(0);
  });

  it("rejects when lunatic is not enabled", () => {
    const draft = makeIdle();
    draft.config.enabledRoleIds = draft.config.enabledRoleIds.filter((id) => id !== "lunatic");
    expect(() => applyAssignLunatic(draft, "player-1")).toThrow(/not enabled/i);
  });

  it("reserves an outsider slot during an active draft", () => {
    const draft = makeIdle();
    draft.status = "active";
    draft.draftOrder = ["player-1", "player-2"];
    draft.remainingSlots = { townsfolk: 2, outsider: 1, minion: 1, demon: 1 };
    const next = applyAssignLunatic(draft, "player-2");
    expect(next.secretAssignments["player-2"]).toBe("lunatic");
    expect(next.remainingSlots.outsider).toBe(0);
  });
});

describe("marionette seating", () => {
  it("detects circular neighbors", () => {
    expect(seatsAreNeighbors(1, 2, 7)).toBe(true);
    expect(seatsAreNeighbors(1, 7, 7)).toBe(true);
    expect(seatsAreNeighbors(1, 3, 7)).toBe(false);
  });

  it("swaps marionette next to demon when needed", () => {
    // 5 seats: demon at 1, marionette at 3 (not adjacent — neighbors of 1 are 2 and 5)
    const players = [
      { id: "d", seat: 1 },
      { id: "a", seat: 2 },
      { id: "m", seat: 3 },
      { id: "b", seat: 4 },
      { id: "c", seat: 5 },
    ];
    const swaps = planMarionetteSeatSwaps(players, {
      d: "imp",
      a: "washerwoman",
      m: "marionette",
      b: "librarian",
      c: "chef",
    });
    expect(swaps).toHaveLength(2);
    const marionetteSeat = swaps.find((s) => s.playerId === "m")?.seat;
    expect([2, 5]).toContain(marionetteSeat);
  });

  it("returns no swaps when already adjacent", () => {
    const players = [
      { id: "d", seat: 1 },
      { id: "m", seat: 2 },
      { id: "a", seat: 3 },
    ];
    expect(
      planMarionetteSeatSwaps(players, { d: "imp", m: "marionette", a: "chef" }),
    ).toEqual([]);
  });
});

describe("applyPick", () => {
  function makeDraft(): BuffetDraftState {
    return {
      status: "active",
      config: defaultBuffetConfig(),
      pool: ["washerwoman", "librarian", "imp", "poisoner", "butler"],
      remainingSlots: { townsfolk: 2, outsider: 0, minion: 1, demon: 1 },
      draftOrder: ["player-1", "player-2", "player-3", "player-4"],
      currentIndex: 0,
      currentOffer: {
        playerId: "player-1",
        roleIds: ["washerwoman", "librarian", "imp"],
        mulliganStep: 0,
      },
      mulligansUsed: {},
      picks: {},
      ...emptySecrets(),
    };
  }

  it("assigns the picked role and advances index", () => {
    const state = applyPick(makeDraft(), "player-1", "washerwoman");
    expect(state.picks["player-1"]).toBe("washerwoman");
    expect(state.currentIndex).toBe(1);
    expect(state.currentOffer).toBeNull();
  });

  it("removes picked role from pool", () => {
    const state = applyPick(makeDraft(), "player-1", "washerwoman");
    expect(state.pool).not.toContain("washerwoman");
  });

  it("removes unchosen roles from pool when recycleUnchosen=false", () => {
    const draft = makeDraft();
    draft.config = { ...draft.config, recycleUnchosen: false };
    const state = applyPick(draft, "player-1", "washerwoman");
    expect(state.pool).not.toContain("librarian");
    expect(state.pool).not.toContain("imp");
    expect(state.pool).toContain("poisoner");
    expect(state.pool).toContain("butler");
  });

  it("keeps unchosen roles in pool when recycleUnchosen=true", () => {
    const draft = makeDraft();
    draft.config = { ...draft.config, recycleUnchosen: true };
    const state = applyPick(draft, "player-1", "washerwoman");
    expect(state.pool).toContain("librarian");
    expect(state.pool).toContain("imp");
  });

  it("decrements the correct slot type", () => {
    const state = applyPick(makeDraft(), "player-1", "washerwoman");
    expect(state.remainingSlots.townsfolk).toBe(1);
    expect(state.remainingSlots.demon).toBe(1);
  });

  it("applies baron outsider adjustment on pick", () => {
    const draft = makeDraft();
    draft.pool = ["baron", "poisoner", "imp", "washerwoman", "butler"];
    draft.remainingSlots = { townsfolk: 3, outsider: 0, minion: 1, demon: 1 };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["baron", "poisoner", "imp"],
      mulliganStep: 0,
    };
    const state = applyPick(draft, "player-1", "baron", { outsiderAdjustment: 2 });
    expect(state.picks["player-1"]).toBe("baron");
    expect(state.remainingSlots.minion).toBe(0);
    expect(state.remainingSlots.outsider).toBe(2);
    expect(state.remainingSlots.townsfolk).toBe(1);
  });

  it("stores lunatic as true role and keeps belief", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-1": "lunatic" };
    draft.remainingSlots = { townsfolk: 2, outsider: 0, minion: 1, demon: 1 };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["imp"],
      mulliganStep: 0,
    };
    draft.pool = ["imp", "washerwoman", "poisoner"];
    const state = applyPick(draft, "player-1", "imp");
    expect(state.picks["player-1"]).toBe("lunatic");
    expect(state.beliefs["player-1"]).toBe("imp");
    expect(state.remainingSlots.demon).toBe(1);
    expect(state.pool).toContain("imp");
  });

  it("stores marionette as true role with townsfolk belief", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-1": "marionette" };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["washerwoman", "librarian"],
      mulliganStep: 0,
    };
    const state = applyPick(draft, "player-1", "washerwoman");
    expect(state.picks["player-1"]).toBe("marionette");
    expect(state.beliefs["player-1"]).toBe("washerwoman");
    expect(state.remainingSlots.townsfolk).toBe(2);
  });

  it("stores drunk as true role with townsfolk belief", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-1": "drunk" };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["washerwoman", "librarian"],
      mulliganStep: 0,
    };
    const state = applyPick(draft, "player-1", "librarian");
    expect(state.picks["player-1"]).toBe("drunk");
    expect(state.beliefs["player-1"]).toBe("librarian");
  });

  it("lil monsta defers assignment and adds a minion slot", () => {
    const draft = makeDraft();
    draft.pool = ["lilmonsta", "imp", "poisoner", "baron", "washerwoman"];
    draft.remainingSlots = { townsfolk: 2, outsider: 0, minion: 1, demon: 1 };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["lilmonsta", "imp"],
      mulliganStep: 0,
      offerKind: "standard",
    };
    const state = applyPick(draft, "player-1", "lilmonsta");
    expect(state.picks["player-1"]).toBeUndefined();
    expect(state.inPlayDemon).toBe("lilmonsta");
    expect(state.remainingSlots.demon).toBe(0);
    expect(state.remainingSlots.minion).toBe(2);
    expect(state.currentIndex).toBe(0);
    expect(state.pool).not.toContain("lilmonsta");

    const followUp = buildLilMonstaMinionOffer(state, "player-1");
    expect(followUp.offerKind).toBe("lilmonsta-minion");
    expect(followUp.roleIds.length).toBeGreaterThan(0);
    for (const id of followUp.roleIds) {
      expect(listBotcRoles().find((r) => r.id === id)?.team).toBe("minion");
    }

    const afterMinion = applyPick(
      { ...state, currentOffer: followUp },
      "player-1",
      followUp.roleIds[0]!,
    );
    expect(afterMinion.picks["player-1"]).toBe(followUp.roleIds[0]);
    expect(afterMinion.inPlayDemon).toBe("lilmonsta");
    expect(afterMinion.currentIndex).toBe(1);
  });

  it("marks status as complete when all players have picked", () => {
    const draft = makeDraft();
    draft.draftOrder = ["player-1"];
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["washerwoman", "librarian", "imp"],
      mulliganStep: 0,
    };
    const state = applyPick(draft, "player-1", "washerwoman");
    expect(state.status).toBe("complete");
  });

  it("throws if player is not current drafter", () => {
    expect(() => applyPick(makeDraft(), "player-2", "washerwoman")).toThrow();
  });

  it("throws if role was not in offer", () => {
    expect(() => applyPick(makeDraft(), "player-1", "poisoner")).toThrow();
  });
});

describe("applyMulligan", () => {
  function makeDraft(): BuffetDraftState {
    return {
      status: "active",
      config: { ...defaultBuffetConfig(), mulliganSteps: [3, 2, 1] },
      pool: buildInitialPool(defaultBuffetConfig().enabledRoleIds),
      remainingSlots: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
      draftOrder: ["player-1", "player-2"],
      currentIndex: 0,
      currentOffer: {
        playerId: "player-1",
        roleIds: ["washerwoman", "librarian", "investigator"],
        mulliganStep: 0,
      },
      mulligansUsed: {},
      picks: {},
      ...emptySecrets(),
    };
  }

  it("returns new offer with fewer choices on first mulligan", () => {
    const { state, newOffer } = applyMulligan(makeDraft(), "player-1");
    expect(newOffer.length).toBeLessThan(3);
    expect(state.mulligansUsed["player-1"]).toBe(1);
    expect(state.currentOffer?.mulliganStep).toBe(1);
  });

  it("throws when no more mulligan steps remain", () => {
    const draft = makeDraft();
    draft.currentOffer = { ...draft.currentOffer!, mulliganStep: 2 };
    expect(() => applyMulligan(draft, "player-1")).toThrow(/no more mulligans/i);
  });

  it("throws if wrong player tries to mulligan", () => {
    expect(() => applyMulligan(makeDraft(), "player-2")).toThrow();
  });

  it("mulligan for lunatic still offers demons", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-1": "lunatic" };
    draft.config = {
      ...draft.config,
      enabledRoleIds: ["washerwoman", "imp", "zombuul", "fanggu", "poisoner"],
    };
    draft.pool = ["washerwoman", "poisoner"]; // real Imp already drafted — gone from pool
    draft.remainingSlots = { townsfolk: 5, outsider: 0, minion: 1, demon: 0 };
    draft.currentOffer = {
      playerId: "player-1",
      roleIds: ["imp"],
      mulliganStep: 0,
    };
    const { newOffer } = applyMulligan(draft, "player-1");
    expect(newOffer.length).toBeGreaterThan(0);
    const roles = listBotcRoles();
    for (const id of newOffer) {
      expect(roles.find((r) => r.id === id)?.team).toBe("demon");
    }
    // May include Imp even though it is no longer in the live draft pool.
    expect(newOffer.every((id) => ["imp", "zombuul", "fanggu"].includes(id))).toBe(true);
  });

  it("lunatic first offer can include demons already removed from the pool", () => {
    const draft = makeDraft();
    draft.secretAssignments = { "player-1": "lunatic" };
    draft.config = {
      ...draft.config,
      enabledRoleIds: ["washerwoman", "imp", "zombuul", "poisoner"],
      mulliganSteps: [2, 1],
    };
    draft.pool = ["washerwoman", "poisoner"];
    draft.remainingSlots = { townsfolk: 2, outsider: 0, minion: 1, demon: 0 };
    draft.currentOffer = null;
    const offer = buildNextOffer(draft);
    expect(offer?.roleIds).toHaveLength(2);
    expect(offer?.roleIds.every((id) => id === "imp" || id === "zombuul")).toBe(true);
  });
});

describe("shuffle", () => {
  it("returns all elements in some order", () => {
    const items = [1, 2, 3, 4, 5];
    const result = shuffle(items);
    expect(result).toHaveLength(5);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not mutate the input", () => {
    const items = [1, 2, 3];
    shuffle(items);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe("GameEngine buffet draft integration", () => {
  it("rejects StartBuffetDraft outside setup phase", () => {
    const engine = new GameEngine(gameId);
    engine.apply({
      type: GameEventType.GameCreated,
      gameId,
      guildId: "g",
      channelId: "c",
      storytellerId: "s",
      timestamp: new Date().toISOString(),
    });
    expect(() =>
      engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId }),
    ).toThrow(/setup/i);
  });

  it("rejects StartBuffetDraft when players already have non-secret roles", () => {
    const engine = engineWithTown(7);
    engine.apply({
      type: GameEventType.RoleAssigned,
      gameId,
      playerId: "player-1",
      roleId: "washerwoman",
      timestamp: new Date().toISOString(),
    });
    expect(() =>
      engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId }),
    ).toThrow(/role/i);
  });

  it("respects Lunatic assigned on a player before buffet-start", () => {
    const engine = engineWithTown(7);
    engine.apply({
      type: GameEventType.RoleAssigned,
      gameId,
      playerId: "player-3",
      roleId: "lunatic",
      timestamp: new Date().toISOString(),
    });
    const events = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    for (const e of events) engine.apply(e);
    const draft = engine.getState().buffetDraft;
    expect(draft?.secretAssignments["player-3"]).toBe("lunatic");
    if (draft?.currentOffer?.playerId === "player-3") {
      const roles = listBotcRoles();
      for (const id of draft.currentOffer.roleIds) {
        expect(roles.find((r) => r.id === id)?.team).toBe("demon");
      }
    }
  });

  it("emits BuffetDraftStarted + BuffetChoicesOffered on start", () => {
    const engine = engineWithTown(7);
    const events = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    const types = events.map((e) => e.type);
    expect(types).toContain(GameEventType.BuffetDraftStarted);
    expect(types).toContain(GameEventType.BuffetChoicesOffered);
  });

  it("draft order is a random permutation of seated players", () => {
    const engine = engineWithTown(7);
    const events = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    const started = events.find((e) => e.type === GameEventType.BuffetDraftStarted) as
      | import("./index.js").BuffetDraftStartedEvent
      | undefined;
    expect(started).toBeDefined();
    expect(started!.draftOrder).toHaveLength(7);
    const playerIds = Array.from({ length: 7 }, (_, i) => `player-${i + 1}`);
    expect([...started!.draftOrder].sort()).toEqual([...playerIds].sort());
  });

  it("never offers drunk, lunatic or marionette in choices", () => {
    const engine = engineWithTown(7);
    const startEvents = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    for (const e of startEvents) engine.apply(e);
    const offer = engine.getState().buffetDraft?.currentOffer;
    expect(offer?.roleIds).not.toContain("drunk");
    expect(offer?.roleIds).not.toContain("lunatic");
    expect(offer?.roleIds).not.toContain("marionette");
  });

  it("can offer hermit when outsider slots remain", () => {
    const pool = buildPickablePool(defaultBuffetConfig().enabledRoleIds);
    expect(pool).toContain("hermit");
    const outsiderOffer = drawOfferByTeam(pool, "outsider", pool.length);
    expect(outsiderOffer).toContain("hermit");
  });

  it("starts with no demon slots when summoner is enabled", () => {
    const engine = engineWithTown(7);
    engine
      .handle({
        kind: GameCommandKind.ConfigureBuffetDraft,
        gameId,
        config: {
          enabledRoleIds: [
            "washerwoman",
            "librarian",
            "investigator",
            "chef",
            "empath",
            "monk",
            "butler",
            "recluse",
            "poisoner",
            "summoner",
            "imp",
          ],
        },
      })
      .forEach((e) => engine.apply(e));

    const startEvents = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    for (const e of startEvents) engine.apply(e);
    const draft = engine.getState().buffetDraft!;
    expect(draft.remainingSlots.demon).toBe(0);
    for (let i = 0; i < 15; i++) {
      const offer = draft.currentOffer;
      if (!offer) break;
      // Demons should never appear while Summoner setup is active
      for (const id of offer.roleIds) {
        expect(listBotcRoles().find((r) => r.id === id)?.team).not.toBe("demon");
      }
    }
  });

  it("ConfigureBuffetDraft persists config before start", () => {
    const engine = engineWithTown(7);
    const events = engine.handle({
      kind: GameCommandKind.ConfigureBuffetDraft,
      gameId,
      config: { recycleUnchosen: true },
    });
    expect(events[0]?.type).toBe(GameEventType.BuffetDraftConfigured);
    for (const e of events) engine.apply(e);
    expect(engine.getState().buffetDraft?.config.recycleUnchosen).toBe(true);
  });

  it("full draft: all players pick and draft completes with RolesDealt", () => {
    const playerCount = 5;
    const engine = engineWithTown(playerCount);
    const startEvents = engine.handle({
      kind: GameCommandKind.StartBuffetDraft,
      gameId,
      devMode: true,
    });
    for (const e of startEvents) engine.apply(e);

    let draft = engine.getState().buffetDraft!;
    expect(draft.status).toBe("active");

    let allEvents: GameEvent[] = [];
    while (draft.status === "active") {
      const offer = draft.currentOffer!;
      expect(offer.roleIds.length).toBeGreaterThan(0);
      const roleId = offer.roleIds[0]!;
      const pickEvents = engine.handle({
        kind: GameCommandKind.PickBuffetRole,
        gameId,
        playerId: offer.playerId,
        roleId,
      });
      for (const e of pickEvents) engine.apply(e);
      allEvents = allEvents.concat(pickEvents);
      draft = engine.getState().buffetDraft!;
    }

    expect(draft.status).toBe("complete");
    const rolesDealt = allEvents.find((e) => e.type === GameEventType.RolesDealt);
    expect(rolesDealt).toBeDefined();

    const state = engine.getState();
    for (const player of state.players) {
      expect(player.roleId).toBeTruthy();
    }
  });

  it("records outsiderAdjustment on baron pick events", () => {
    const engine = engineWithTown(7);
    engine
      .handle({
        kind: GameCommandKind.ConfigureBuffetDraft,
        gameId,
        config: {
          enabledRoleIds: [
            "washerwoman",
            "librarian",
            "investigator",
            "chef",
            "empath",
            "butler",
            "recluse",
            "baron",
            "poisoner",
            "imp",
          ],
          recycleUnchosen: true,
        },
      })
      .forEach((e) => engine.apply(e));

    const startEvents = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    for (const e of startEvents) engine.apply(e);

    const live = engine.getState().buffetDraft!;
    const playerId =
      live.draftOrder.find((id) => !live.secretAssignments[id]) ?? live.draftOrder[0]!;

    // Offer is stored on engine state via events (getState() returns a clone).
    engine.apply({
      type: GameEventType.BuffetChoicesOffered,
      gameId,
      offer: {
        playerId,
        roleIds: ["baron", "poisoner", "imp"],
        mulliganStep: 0,
      },
      timestamp: new Date().toISOString(),
    });

    const pickEvents = engine.handle({
      kind: GameCommandKind.PickBuffetRole,
      gameId,
      playerId,
      roleId: "baron",
    });
    const picked = pickEvents.find((e) => e.type === GameEventType.BuffetRolePicked) as
      | import("./index.js").BuffetRolePickedEvent
      | undefined;
    expect(picked?.outsiderAdjustment).toBe(2);
  });

  it("emits BuffetMulliganUsed and new offer on mulligan", () => {
    const engine = engineWithTown(7);
    const startEvents = engine.handle({ kind: GameCommandKind.StartBuffetDraft, gameId });
    for (const e of startEvents) engine.apply(e);

    const draft = engine.getState().buffetDraft!;
    const currentPlayerId = draft.currentOffer!.playerId;

    const mulliganEvents = engine.handle({
      kind: GameCommandKind.MulliganBuffet,
      gameId,
      playerId: currentPlayerId,
    });
    const types = mulliganEvents.map((e) => e.type);
    expect(types).toContain(GameEventType.BuffetMulliganUsed);
  });

  it("supports manual picks for all fake players", () => {
    const playerCount = 8;
    const engine = engineWithTown(playerCount, { fake: true });
    const startEvents = engine.handle({
      kind: GameCommandKind.StartBuffetDraft,
      gameId,
    });
    for (const e of startEvents) engine.apply(e);

    let draft = engine.getState().buffetDraft!;
    while (draft.status === "active") {
      const offer = draft.currentOffer!;
      expect(offer.roleIds.length).toBeGreaterThan(0);
      const player = engine.getState().players.find((p) => p.id === offer.playerId)!;
      expect(player.isFake).toBe(true);
      const pickEvents = engine.handle({
        kind: GameCommandKind.PickBuffetRole,
        gameId,
        playerId: offer.playerId,
        roleId: offer.roleIds[0]!,
      });
      for (const e of pickEvents) engine.apply(e);
      draft = engine.getState().buffetDraft!;
    }

    expect(draft.status).toBe("complete");
    expect(engine.getState().players.every((p) => p.roleId)).toBe(true);
  });
});

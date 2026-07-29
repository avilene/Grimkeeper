import { describe, expect, it } from "vitest";
import {
  defaultBuffetConfig,
  buildInitialPool,
  computeRemainingSlots,
  validatePoolForComposition,
  drawOffer,
  applyPick,
  applyMulligan,
  shuffle,
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
  it("includes all non-traveler roles by default", () => {
    const config = defaultBuffetConfig();
    expect(config.enabledRoleIds.length).toBeGreaterThan(100);
    expect(config.recycleUnchosen).toBe(false);
    expect(config.mulliganSteps).toEqual([3, 2, 1]);
    expect(config.scriptPreset).toBe("all");
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
    const error = validatePoolForComposition(pool, { townsfolk: 0, outsider: 0, minion: 0, demon: 999 });
    expect(error).toMatch(/demon/i);
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

  it("offers fewer than N when pool is small", () => {
    const offer = drawOffer(["imp"], { townsfolk: 0, outsider: 0, minion: 0, demon: 1 }, 3);
    expect(offer).toHaveLength(1);
    expect(offer[0]).toBe("imp");
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
    // librarian and imp were unchosen and should be removed
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
    expect(state.remainingSlots["townsfolk"]).toBe(1);
    expect(state.remainingSlots["demon"]).toBe(1);
  });

  it("marks status as complete when all players have picked", () => {
    let draft = makeDraft();
    draft.draftOrder = ["player-1"];
    draft.currentOffer = { playerId: "player-1", roleIds: ["washerwoman", "librarian", "imp"], mulliganStep: 0 };
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
    };
  }

  it("returns new offer with fewer choices on first mulligan", () => {
    const { state, newOffer } = applyMulligan(makeDraft(), "player-1");
    expect(newOffer.length).toBeLessThan(3);
    expect(state.mulligansUsed["player-1"]).toBe(1);
    expect(state.currentOffer?.mulliganStep).toBe(1);
  });

  it("throws when no more mulligan steps remain", () => {
    let draft = makeDraft();
    draft.currentOffer = { ...draft.currentOffer!, mulliganStep: 2 };
    expect(() => applyMulligan(draft, "player-1")).toThrow(/no more mulligans/i);
  });

  it("throws if wrong player tries to mulligan", () => {
    expect(() => applyMulligan(makeDraft(), "player-2")).toThrow();
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

  it("rejects StartBuffetDraft when players already have roles", () => {
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

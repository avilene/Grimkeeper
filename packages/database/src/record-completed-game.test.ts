import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, GameEventType, getStorytellerDiscordIds } from "@grimkeeper/engine";

vi.mock("./client.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    game: {
      create: vi.fn(),
    },
    gameEvent: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./client.js";
import {
  GAME_SOURCE_STATS_ONLY,
  STATS_ONLY_CHANNEL_ID,
  buildRecordedGameEvents,
  recordCompletedGame,
  storytellerIdsFromEvents,
} from "./record-completed-game.js";

describe("buildRecordedGameEvents", () => {
  const baseInput = {
    guildId: "guild-1",
    channelId: "channel-1",
    winner: "good" as const,
    startedAt: new Date("2026-07-01T18:00:00.000Z"),
    endedAt: new Date("2026-07-01T22:30:00.000Z"),
    storytellerId: "st-primary",
    coStorytellerIds: ["st-co-1", "st-primary", "st-co-2", ""],
    players: [
      {
        discordUserId: "p1",
        displayName: "Alice",
        seat: 1,
        roleId: "washerwoman",
        team: "good",
      },
      {
        discordUserId: "p2",
        displayName: "Bob",
        seat: 2,
        roleId: "imp",
        team: "evil",
      },
    ],
  };

  it("stores primary ST on GameCreated and co-STs via StorytellerPromoted", () => {
    const playerIds = ["pid-1", "pid-2"];
    const events = buildRecordedGameEvents("game-1", baseInput, playerIds);

    expect(events[0]).toMatchObject({
      type: GameEventType.GameCreated,
      storytellerId: "st-primary",
      guildId: "guild-1",
      channelId: "channel-1",
      timestamp: "2026-07-01T18:00:00.000Z",
    });

    const promoted = events.filter((e) => e.type === GameEventType.StorytellerPromoted);
    expect(promoted).toHaveLength(2);
    expect(promoted.map((e) => ("discordUserId" in e ? e.discordUserId : ""))).toEqual([
      "st-co-1",
      "st-co-2",
    ]);

    const engine = GameEngine.fromEvents("game-1", events);
    const state = engine.getState();
    expect(state.phase).toBe("ended");
    expect(state.winner).toBe("good");
    expect(state.storytellerId).toBe("st-primary");
    expect(state.promotedStorytellerIds).toEqual(["st-co-1", "st-co-2"]);
    expect(getStorytellerDiscordIds(state)).toEqual(["st-primary", "st-co-1", "st-co-2"]);
    expect(storytellerIdsFromEvents("game-1", events)).toEqual([
      "st-primary",
      "st-co-1",
      "st-co-2",
    ]);
    expect(state.players).toHaveLength(2);
    expect(state.players[0]).toMatchObject({
      id: "pid-1",
      discordUserId: "p1",
      roleId: "washerwoman",
      seat: 1,
    });
    expect(state.players[1]).toMatchObject({
      id: "pid-2",
      discordUserId: "p2",
      roleId: "imp",
      seat: 2,
    });

    const ended = events[events.length - 1];
    expect(ended).toMatchObject({
      type: GameEventType.GameEnded,
      winner: "good",
      timestamp: "2026-07-01T22:30:00.000Z",
    });
  });

  it("defaults channel to stats-only sentinel", () => {
    const events = buildRecordedGameEvents(
      "game-2",
      { ...baseInput, channelId: null },
      ["a", "b"],
    );
    expect(events[0]).toMatchObject({
      type: GameEventType.GameCreated,
      channelId: STATS_ONLY_CHANNEL_ID,
    });
  });

  it("rejects ended before started", () => {
    expect(() =>
      buildRecordedGameEvents(
        "game-3",
        {
          ...baseInput,
          startedAt: new Date("2026-07-02T00:00:00.000Z"),
          endedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        ["a", "b"],
      ),
    ).toThrow(/Ended at must be on or after/);
  });

  it("rejects empty players", () => {
    expect(() =>
      buildRecordedGameEvents("game-4", { ...baseInput, players: [] }, []),
    ).toThrow(/At least one player/);
  });
});

describe("recordCompletedGame", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("writes ended stats_only game, players, and sequential events", async () => {
    const creates: Array<{ kind: string; data: unknown }> = [];
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        game: {
          create: vi.fn(async ({ data }: { data: unknown }) => {
            creates.push({ kind: "game", data });
            return data;
          }),
        },
        gameEvent: {
          create: vi.fn(async ({ data }: { data: unknown }) => {
            creates.push({ kind: "event", data });
            return data;
          }),
        },
      };
      return fn(tx as never);
    });

    const result = await recordCompletedGame({
      guildId: "guild-1",
      winner: "evil",
      startedAt: new Date("2026-06-01T12:00:00.000Z"),
      endedAt: new Date("2026-06-01T16:00:00.000Z"),
      storytellerId: "st-1",
      coStorytellerIds: ["st-2"],
      players: [
        { discordUserId: "u1", displayName: "One", roleId: "imp", team: "evil" },
      ],
    });

    expect(result.gameId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const gameCreate = creates.find((c) => c.kind === "game");
    expect(gameCreate?.data).toMatchObject({
      id: result.gameId,
      guildId: "guild-1",
      channelId: STATS_ONLY_CHANNEL_ID,
      phase: "ended",
      winner: "evil",
      source: GAME_SOURCE_STATS_ONLY,
    });

    const eventCreates = creates.filter((c) => c.kind === "event");
    expect(eventCreates.length).toBeGreaterThanOrEqual(4);
    expect(eventCreates.map((c) => (c.data as { seq: number }).seq)).toEqual(
      eventCreates.map((_, i) => i + 1),
    );
    const types = eventCreates.map((c) => (c.data as { type: string }).type);
    expect(types[0]).toBe(GameEventType.GameCreated);
    expect(types).toContain(GameEventType.StorytellerPromoted);
    expect(types[types.length - 1]).toBe(GameEventType.GameEnded);
  });
});

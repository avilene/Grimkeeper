import { beforeEach, describe, expect, it, vi } from "vitest";

const appendGameEvent = vi.fn();
const loadDayProjectionForRefresh = vi.fn();
const syncGameProjection = vi.fn();
const refreshGameStatusForEngine = vi.fn();

vi.mock("@grimkeeper/database", () => ({
  appendGameEvent: (...args: unknown[]) => appendGameEvent(...args),
  loadDayProjectionForRefresh: (...args: unknown[]) => loadDayProjectionForRefresh(...args),
}));

vi.mock("./day-thread.js", () => ({
  findNominationMessage: vi.fn(),
}));

vi.mock("./commands/command-context.js", () => ({
  ensureVotingChannel: vi.fn(),
  postNominationEverywhere: vi.fn(),
  refreshAllNominationEverywhere: vi.fn(),
  syncGameProjection: (...args: unknown[]) => syncGameProjection(...args),
  toJson: (value: unknown) => value,
}));

vi.mock("./game-events-log.js", () => ({
  logGameEvent: vi.fn(),
}));

vi.mock("./game-status.js", () => ({
  refreshGameStatusForEngine: (...args: unknown[]) => refreshGameStatusForEngine(...args),
}));

vi.mock("./interactions/lock-votes.js", () => ({
  cancelVoteDeadlineReminder: vi.fn(),
  scheduleNominationVoteDeadlineReminder: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  log: vi.fn(),
}));

import { GameCommandKind, GameEngine, GameEventType } from "@grimkeeper/engine";

import {
  reconcileDayProjectionIntoEngine,
  shouldKeepVoteDeadlineReminder,
  voteDeadlineChanged,
} from "./refresh-noms-from-projection.js";

const gameId = "game-1";

function setupTownEngine(playerCount = 3): GameEngine {
  const engine = GameEngine.fromEvents(gameId, [
    {
      type: GameEventType.GameCreated,
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
      timestamp: new Date().toISOString(),
    },
  ]);
  const setupEvents = engine.handle({
    kind: GameCommandKind.SetupTown,
    gameId,
    channelId: "town-channel",
    players: Array.from({ length: playerCount }, (_, index) => ({
      playerId: `player-${index + 1}`,
      discordUserId: `user-${index + 1}`,
      displayName: `Player ${index + 1}`,
    })),
    minPlayers: 2,
  });
  for (const event of setupEvents) engine.apply(event);
  const nightEvents = engine.handle({
    kind: GameCommandKind.AdvancePhase,
    gameId,
    targetPhase: "night",
  });
  for (const event of nightEvents) engine.apply(event);
  const dayEvents = engine.handle({
    kind: GameCommandKind.AdvancePhase,
    gameId,
    targetPhase: "day",
  });
  for (const event of dayEvents) engine.apply(event);
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voteDeadlineChanged", () => {
  it("is false when both sides match", () => {
    const at = new Date("2026-07-02T12:00:00.000Z");
    expect(voteDeadlineChanged(at.toISOString(), at)).toBe(false);
  });

  it("is true when projection moves the deadline", () => {
    expect(
      voteDeadlineChanged(
        "2026-07-02T12:00:00.000Z",
        new Date("2026-07-02T18:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("is true when clearing or setting a deadline", () => {
    expect(voteDeadlineChanged("2026-07-02T12:00:00.000Z", null)).toBe(true);
    expect(voteDeadlineChanged(null, new Date("2026-07-02T12:00:00.000Z"))).toBe(true);
    expect(voteDeadlineChanged(null, null)).toBe(false);
  });
});

describe("shouldKeepVoteDeadlineReminder", () => {
  const deadline = "2026-07-02T12:00:00.000Z";

  it("keeps reminders for open unlocked noms with a deadline", () => {
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: false,
        voteDeadlineAt: deadline,
      }),
    ).toBe(true);
  });

  it("cancels for locked, resolved, or missing deadline", () => {
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: true,
        voteDeadlineAt: deadline,
      }),
    ).toBe(false);
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "resolved_pass",
        votesLocked: false,
        voteDeadlineAt: deadline,
      }),
    ).toBe(false);
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: false,
        voteDeadlineAt: null,
      }),
    ).toBe(false);
  });
});

describe("reconcileDayProjectionIntoEngine", () => {
  it("syncs public and private projection votes into the engine state", async () => {
    const engine = setupTownEngine();
    const players = engine.getState().players;
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Projection vote sync",
    })) {
      engine.apply(event);
    }
    const nomination = engine.getState().day!.nominations[0]!;
    const voter = players[2]!;

    loadDayProjectionForRefresh.mockResolvedValue({
      discordThreadId: "vote-thread-1",
      nominations: [
        {
          id: nomination.id,
          nominatorId: nomination.nominatorId,
          nomineeId: nomination.nomineeId,
          accusation: nomination.accusation,
          defense: nomination.defense ?? null,
          order: nomination.order,
          status: nomination.status,
          voteDeadlineAt: nomination.voteDeadlineAt ? new Date(nomination.voteDeadlineAt) : null,
          votes: [
            {
              voterId: voter.id,
              choice: "yes",
              reason: "Public vote",
              isPrivate: false,
            },
            {
              voterId: voter.id,
              choice: "no",
              reason: "Private vote",
              isPrivate: true,
            },
          ],
        },
      ],
    });

    const result = await reconcileDayProjectionIntoEngine(engine);

    expect(result).toEqual({ appended: 3 });
    expect(appendGameEvent).toHaveBeenNthCalledWith(
      1,
      gameId,
      GameEventType.DayOpened,
      expect.objectContaining({ discordThreadId: "vote-thread-1" }),
    );
    expect(appendGameEvent).toHaveBeenNthCalledWith(
      2,
      gameId,
      GameEventType.VoteCast,
      expect.objectContaining({
        nominationId: nomination.id,
        voterId: voter.id,
        choice: "yes",
        privateBallot: false,
      }),
    );
    expect(appendGameEvent).toHaveBeenNthCalledWith(
      3,
      gameId,
      GameEventType.VoteCast,
      expect.objectContaining({
        nominationId: nomination.id,
        voterId: voter.id,
        choice: "no",
        privateBallot: true,
      }),
    );
    expect(engine.formatNominationTally(nomination.id, { ballot: "public" })).toContain("Yes: 1");
    expect(engine.formatNominationTally(nomination.id, { ballot: "private" })).toContain("No: 1");
    expect(engine.formatNominationVoteRoll(nomination.id, { audience: "storyteller" })).toContain(
      "(public: yes)",
    );
    expect(syncGameProjection).toHaveBeenCalledWith(gameId, engine);
    expect(refreshGameStatusForEngine).toHaveBeenCalledWith(engine);
  });
});

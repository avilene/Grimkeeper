import { describe, expect, it, vi } from "vitest";
import {
  GameEngine,
  GameCommandKind,
  GameEventType,
  type GameEvent,
  DEV_MIN_PLAYERS,
  resolveStandardScript,
  StandardEdition,
  passesExecutionVote,
  votesNeededOnTheBlock,
} from "./index.js";

const gameId = "game-1";
const script = resolveStandardScript(StandardEdition.TB);

function baseEvents(): GameEvent[] {
  return [
    {
      type: GameEventType.GameCreated,
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
      script,
      timestamp: new Date().toISOString(),
    },
  ];
}

function withPlayers(count: number): GameEvent[] {
  const events = baseEvents();
  for (let i = 0; i < count; i++) {
    events.push({
      type: GameEventType.PlayerAdded,
      gameId,
      playerId: `player-${i + 1}`,
      discordUserId: `user-${i + 1}`,
      displayName: `Player ${i + 1}`,
      timestamp: new Date().toISOString(),
    });
  }
  return events;
}

describe("GameEngine", () => {
  it("creates a game without a script", () => {
    const engine = new GameEngine(gameId);
    const events = engine.handle({
      kind: GameCommandKind.CreateGame,
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
    });
    expect(events).toHaveLength(1);
    expect(engine.getState().script).toBeNull();
  });

  it("replays events into consistent state", () => {
    const events = withPlayers(2);
    const engine = GameEngine.fromEvents(gameId, events);
    const state = engine.getState();

    expect(state.phase).toBe("lobby");
    expect(state.players).toHaveLength(2);
    expect(state.players[0]?.seat).toBe(1);
    expect(state.script?.name).toBe("Trouble Brewing");
  });

  it("starts setup without dealing roles", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    const emitted = engine.handle({
      kind: GameCommandKind.StartGame,
      gameId,
      minPlayers: 5,
    });

    for (const event of emitted) {
      engine.apply(event);
    }

    const state = engine.getState();
    expect(state.phase).toBe("setup");
    expect(state.players.every((player) => !player.roleId)).toBe(true);
  });

  it("deals roles and begins night from setup", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.GameStarted,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const emitted = engine.handle({
      kind: GameCommandKind.DealRoles,
      gameId,
      roleAssignments: engine.getState().players.map((player, index) => ({
        playerId: player.id,
        roleId: ["imp", "washerwoman", "librarian", "investigator", "chef"][index]!,
      })),
    });

    for (const event of emitted) {
      engine.apply(event);
    }

    const state = engine.getState();
    expect(state.phase).toBe("night");
    expect(state.nightNumber).toBe(1);
    expect(state.players.every((player) => player.roleId)).toBe(true);
  });

  it("builds grim reveal lines with role names", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(2));
    engine.apply({
      type: GameEventType.RolesDealt,
      gameId,
      assignments: engine.getState().players.map((player) => ({
        playerId: player.id,
        roleId: "washerwoman",
      })),
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.GameEnded,
      gameId,
      winner: "good",
      reason: "Demon executed",
      timestamp: new Date().toISOString(),
    });

    const reveal = engine.getGrimReveal();
    expect(reveal.some((line) => line.includes("Washerwoman"))).toBe(true);
    expect(reveal.some((line) => line.includes("Winner: good"))).toBe(true);
  });

  it("clears fake players in the lobby", () => {
    const engine = GameEngine.fromEvents(gameId, [
      ...baseEvents(),
      {
        type: GameEventType.PlayerAdded,
        gameId,
        playerId: "fake-1",
        discordUserId: "dev:game-1:1",
        displayName: "Dev Player 1",
        timestamp: new Date().toISOString(),
      },
      {
        type: GameEventType.PlayerAdded,
        gameId,
        playerId: "real-1",
        discordUserId: "user-1",
        displayName: "Real Player",
        timestamp: new Date().toISOString(),
      },
    ]);

    const events = engine.handle({ kind: GameCommandKind.ClearFakePlayers, gameId });
    for (const event of events) engine.apply(event);

    expect(engine.getState().players).toHaveLength(1);
    expect(engine.getState().players[0]?.isFake).toBe(false);
  });

  it("allows a player to leave the lobby", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    const leavingPlayer = engine.getState().players[1]!;
    const emitted = engine.handle({
      kind: GameCommandKind.RemovePlayer,
      gameId,
      playerId: leavingPlayer.id,
    });
    for (const event of emitted) {
      engine.apply(event);
    }

    const state = engine.getState();
    expect(state.players).toHaveLength(2);
    expect(state.players.some((player) => player.id === leavingPlayer.id)).toBe(false);
    expect(state.players[0]?.seat).toBe(1);
    expect(state.players[1]?.seat).toBe(2);
  });

  it("allows dev min players when starting", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    const emitted = engine.handle({
      kind: GameCommandKind.StartGame,
      gameId,
      minPlayers: DEV_MIN_PLAYERS,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe(GameEventType.GameStarted);
  });

  it("assigns roles manually during setup", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    engine.apply({
      type: GameEventType.GameStarted,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const player = engine.getState().players[0]!;
    const events = engine.handle({
      kind: GameCommandKind.AssignRole,
      gameId,
      playerId: player.id,
      roleId: "imp",
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().players[0]?.roleId).toBe("imp");
  });

  it("promotes additional storytellers", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(2));
    expect(engine.isStoryteller("story-1")).toBe(true);
    expect(engine.isStoryteller("user-2")).toBe(false);

    const events = engine.handle({
      kind: GameCommandKind.PromoteStoryteller,
      gameId,
      discordUserId: "user-2",
    });
    for (const event of events) {
      engine.apply(event);
    }

    expect(engine.getStorytellerDiscordIds()).toEqual(["story-1", "user-2"]);
    expect(engine.isStoryteller("user-2")).toBe(true);
  });

  it("rejects promoting an existing storyteller", () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    expect(() =>
      engine.handle({
        kind: GameCommandKind.PromoteStoryteller,
        gameId,
        discordUserId: "story-1",
      }),
    ).toThrow("already a storyteller");
  });

  it("records nominations during the day", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const [nominator, nominee] = engine.getState().players;
    const events = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: nominator!.id,
      nomineeId: nominee!.id,
      accusation: "They blinked suspiciously.",
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().day?.nominations).toHaveLength(1);
    expect(engine.formatNomination(engine.getState().day!.nominations[0]!)).toContain("nominates");
  });

  it("clears nominations when a new day starts", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const [nominator, nominee] = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: nominator!.id,
      nomineeId: nominee!.id,
      accusation: "Suspicious behavior.",
    });
    for (const event of nominationEvents) engine.apply(event);

    engine.apply({
      type: GameEventType.NightStarted,
      gameId,
      nightNumber: 2,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 2,
      timestamp: new Date().toISOString(),
    });

    expect(engine.getState().day?.nominations).toHaveLength(0);
  });

  it("clears seats when the game starts", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    expect(engine.getState().players.every((player) => player.seat !== null)).toBe(true);

    const events = engine.handle({ kind: GameCommandKind.StartGame, gameId, minPlayers: 5 });
    for (const event of events) engine.apply(event);

    expect(engine.getState().phase).toBe("setup");
    expect(engine.getState().players.every((player) => player.seat === null)).toBe(true);
    expect(engine.getState().seatsOpen).toBe(false);
  });

  it("lets players pick seats when the storyteller opens selection", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.GameStarted,
      gameId,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.SeatsOpened,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const player = engine.getState().players[0]!;
    const events = engine.handle({
      kind: GameCommandKind.PickSeat,
      gameId,
      playerId: player.id,
      seat: 3,
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().players[0]?.seat).toBe(3);
    expect(engine.getSeatingChart()[2]).toContain(player.displayName);
  });

  it("rejects picking a seat when selection is closed", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.GameStarted,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const player = engine.getState().players[0]!;
    expect(() =>
      engine.handle({
        kind: GameCommandKind.PickSeat,
        gameId,
        playerId: player.id,
        seat: 1,
      }),
    ).toThrow("not open");
  });

  it("rejects duplicate nominations", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const first = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First accusation.",
    });
    for (const event of first) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[2]!.id,
        nomineeId: players[1]!.id,
        accusation: "Duplicate nominee.",
      }),
    ).toThrow("already been nominated");
  });

  it("resolves nominations in fifo order with majority", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const nominate = (nominatorIndex: number, nomineeIndex: number) => {
      const events = engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[nominatorIndex]!.id,
        nomineeId: players[nomineeIndex]!.id,
        accusation: "Accusation.",
      });
      for (const event of events) engine.apply(event);
      return engine.getState().day!.nominations.at(-1)!;
    };

    const first = nominate(0, 1);
    nominate(2, 3);

    for (const voterIndex of [0, 2, 4]) {
      const voteEvents = engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        voterId: players[voterIndex]!.id,
        nominationId: first.id,
        choice: "yes",
      });
      for (const event of voteEvents) engine.apply(event);
    }

    const resolveEvents = engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
    });
    for (const event of resolveEvents) engine.apply(event);

    expect(engine.getNominationById(first.id)?.status).toBe("resolved_pass");
    expect(engine.getNextOpenNomination()?.nomineeId).toBe(players[3]!.id);
  });

  it("can resolve a specific open nomination out of order", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });
    const players = engine.getState().players;

    const firstEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First.",
    });
    for (const event of firstEvents) engine.apply(event);
    const firstId = engine.getState().day!.nominations[0]!.id;

    const secondEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[2]!.id,
      nomineeId: players[3]!.id,
      accusation: "Second.",
    });
    for (const event of secondEvents) engine.apply(event);
    const secondId = engine.getState().day!.nominations[1]!.id;

    for (const event of engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
      nominationId: secondId,
    })) {
      engine.apply(event);
    }

    expect(engine.getNominationById(secondId)?.status).toBe("resolved_fail");
    expect(engine.getNominationById(firstId)?.status).toBe("open");
  });

  it("blocks a second ghost vote", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[2]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    const firstNominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First accusation.",
    });
    for (const event of firstNominationEvents) engine.apply(event);
    const firstNomination = engine.getState().day!.nominations[0]!;

    const secondNominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[1]!.id,
      nomineeId: players[0]!.id,
      accusation: "Second accusation.",
    });
    for (const event of secondNominationEvents) engine.apply(event);
    const secondNomination = engine.getState().day!.nominations[1]!;

    const firstVote = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      voterId: players[2]!.id,
      nominationId: firstNomination.id,
      choice: "yes",
    });
    for (const event of firstVote) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        voterId: players[2]!.id,
        nominationId: secondNomination.id,
        choice: "yes",
      }),
    ).toThrow("ghost vote");
  });

  it("allows only one execution per day", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    for (const voterIndex of [0, 2, 3, 4]) {
      const voteEvents = engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        voterId: players[voterIndex]!.id,
        nominationId: nomination.id,
        choice: "yes",
      });
      for (const event of voteEvents) engine.apply(event);
    }

    const resolveEvents = engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
    });
    for (const event of resolveEvents) engine.apply(event);

    const executeEvents = engine.handle({
      kind: GameCommandKind.ExecutePlayer,
      gameId,
      playerId: players[1]!.id,
      nominationId: nomination.id,
    });
    for (const event of executeEvents) engine.apply(event);

    expect(engine.getState().day?.executionUsed).toBe(true);
    expect(engine.getPlayerById(players[1]!.id)?.alive).toBe(false);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.ExecutePlayer,
        gameId,
        playerId: players[1]!.id,
        nominationId: nomination.id,
      }),
    ).toThrow("Only one execution");
  });

  it("lets storytellers manually set votes without ghost vote limits", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[4]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    engine.apply({
      type: GameEventType.NominationsClosed,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const voteEvents = engine.handle({
      kind: GameCommandKind.SetPlayerVote,
      gameId,
      voterId: players[4]!.id,
      nominationId: nomination.id,
      choice: "yes",
    });
    for (const event of voteEvents) engine.apply(event);

    expect(engine.getPlayerById(players[4]!.id)?.ghostVoteUsed).toBe(false);
    expect(engine.getEffectiveYesVotes(nomination.id)).toBe(1);
  });

  it("kills a player outside execution", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.NightStarted,
      gameId,
      nightNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const player = engine.getState().players[0]!;
    const events = engine.handle({
      kind: GameCommandKind.KillPlayer,
      gameId,
      playerId: player.id,
      cause: "night",
    });
    for (const event of events) engine.apply(event);

    expect(engine.getPlayerById(player.id)?.alive).toBe(false);
  });

  it("pauses nominations until the pause expires", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const pausedUntil = new Date(Date.now() + 60_000).toISOString();
    const pauseEvents = engine.handle({
      kind: GameCommandKind.PauseNominations,
      gameId,
      pausedUntil,
    });
    for (const event of pauseEvents) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[0]!.id,
        nomineeId: players[1]!.id,
        accusation: "Too soon.",
      }),
    ).toThrow("paused");
  });

  it("stores the day thread id when the day opens", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const events = engine.handle({
      kind: GameCommandKind.OpenDay,
      gameId,
      discordThreadId: "thread-123",
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().day?.discordThreadId).toBe("thread-123");
  });

  it("allows retargeting the day thread overnight when day state remains", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.DayOpened,
      gameId,
      dayNumber: 1,
      discordThreadId: "old-vote",
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.NightStarted,
      gameId,
      nightNumber: 2,
      timestamp: new Date().toISOString(),
    });
    expect(engine.getState().phase).toBe("night");
    expect(engine.getState().day?.discordThreadId).toBe("old-vote");

    const events = engine.handle({
      kind: GameCommandKind.OpenDay,
      gameId,
      discordThreadId: "new-vote",
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().day?.discordThreadId).toBe("new-vote");
  });

  it("records defense text on a nomination", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const defenseEvents = engine.handle({
      kind: GameCommandKind.AddDefense,
      gameId,
      playerId: players[1]!.id,
      nominationId: nomination.id,
      defense: "I am good.",
    });
    for (const event of defenseEvents) engine.apply(event);

    expect(engine.getNominationById(nomination.id)?.defense).toBe("I am good.");
  });

  it("hides vote tallies in secret mode until revealed", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.VoteVisibilitySet,
      gameId,
      visibility: "secret",
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const voteEvents = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      voterId: players[2]!.id,
      nominationId: nomination.id,
      choice: "yes",
    });
    for (const event of voteEvents) engine.apply(event);

    expect(engine.formatNominationTally(nomination.id)).toBe("Votes recorded (secret mode)");
    expect(engine.formatNominationTally(nomination.id, { revealSecret: true })).toContain("Yes: 1");
  });

  it("does not count conditional votes toward execution majority", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });

    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    for (const voterIndex of [0, 2]) {
      const voteEvents = engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        voterId: players[voterIndex]!.id,
        nominationId: nomination.id,
        choice: "yes",
      });
      for (const event of voteEvents) engine.apply(event);
    }

    const conditionalEvents = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      voterId: players[3]!.id,
      nominationId: nomination.id,
      choice: "conditional",
      reason: "If they are the demon.",
    });
    for (const event of conditionalEvents) engine.apply(event);

    expect(engine.getEffectiveYesVotes(nomination.id)).toBe(2);
    expect(engine.getNominationTally(nomination.id).conditional).toBe(1);

    const resolveEvents = engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
    });
    for (const event of resolveEvents) engine.apply(event);

    expect(engine.getNominationById(nomination.id)?.status).toBe("resolved_fail");
  });

  function setupTownInSetup(playerCount = 4): GameEngine {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    const players = Array.from({ length: playerCount }, (_, index) => ({
      playerId: `town-player-${index + 1}`,
      discordUserId: `town-user-${index + 1}`,
      displayName: `Town Player ${index + 1}`,
    }));
    const events = engine.handle({
      kind: GameCommandKind.SetupTown,
      gameId,
      channelId: "town-channel",
      players,
      minPlayers: 2,
    });
    for (const event of events) engine.apply(event);
    return engine;
  }

  function setupTownAtNight(playerCount = 4): GameEngine {
    const engine = setupTownInSetup(playerCount);
    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "night",
    })) {
      engine.apply(event);
    }
    return engine;
  }

  /** Town setup advanced to Day 1 (nominations open) for day-phase tests. */
  function setupTownEngine(playerCount = 4): GameEngine {
    const engine = setupTownAtNight(playerCount);
    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "day",
    })) {
      engine.apply(event);
    }
    return engine;
  }

  it("sets up town in Setup with roster seated and nominations closed", () => {
    const engine = setupTownInSetup(3);
    const state = engine.getState();

    expect(state.phase).toBe("setup");
    expect(state.nightNumber).toBe(0);
    expect(state.dayNumber).toBe(0);
    expect(state.townMode).toBe(true);
    expect(state.players).toHaveLength(3);
    expect(state.players.map((player) => player.seat)).toEqual([1, 2, 3]);
    expect(state.players.every((player) => player.alive && !player.roleId)).toBe(true);
    expect(state.day).toBeNull();
  });

  it("advances from Setup to Night 1", () => {
    const engine = setupTownInSetup(3);
    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "night",
    })) {
      engine.apply(event);
    }
    const state = engine.getState();
    expect(state.phase).toBe("night");
    expect(state.nightNumber).toBe(1);
    expect(state.dayNumber).toBe(0);
    expect(state.day).toBeNull();
  });

  it("resets town back to Setup while keeping the roster", () => {
    const engine = setupTownEngine(3);
    const seats = engine.getState().players.map((player) => ({
      id: player.id,
      discordUserId: player.discordUserId,
      seat: player.seat,
    }));
    for (const event of engine.handle({
      kind: GameCommandKind.ResetTownToSetup,
      gameId,
    })) {
      engine.apply(event);
    }
    const state = engine.getState();
    expect(state.phase).toBe("setup");
    expect(state.nightNumber).toBe(0);
    expect(state.dayNumber).toBe(0);
    expect(state.day).toBeNull();
    expect(state.townMode).toBe(true);
    expect(
      state.players.map((player) => ({
        id: player.id,
        discordUserId: player.discordUserId,
        seat: player.seat,
      })),
    ).toEqual(seats);
    expect(state.players.every((player) => player.alive && !player.ghostVoteUsed)).toBe(true);
  });

  it("advances from Night 1 to Day 1 with nominations open", () => {
    const engine = setupTownAtNight(3);
    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "day",
    })) {
      engine.apply(event);
    }
    const state = engine.getState();
    expect(state.phase).toBe("day");
    expect(state.dayNumber).toBe(1);
    expect(state.nightNumber).toBe(1);
    expect(state.day?.nominationsOpen).toBe(true);
    expect(state.day?.discordThreadId).toBeNull();
  });

  it("enforces one nomination per player and nominee per day in town mode", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;

    const first = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First accusation.",
    });
    for (const event of first) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const resolveEvents = engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
    });
    for (const event of resolveEvents) engine.apply(event);
    expect(engine.getNominationById(nomination.id)?.status).toBe("resolved_fail");

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[0]!.id,
        nomineeId: players[2]!.id,
        accusation: "Second accusation.",
      }),
    ).toThrow("already made a nomination today");

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[2]!.id,
        nomineeId: players[1]!.id,
        accusation: "Same nominee again.",
      }),
    ).toThrow("already been nominated today");
  });

  it("blocks a second open nomination from the same nominator or on the same nominee", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;

    const first = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Open accusation.",
    });
    for (const event of first) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[0]!.id,
        nomineeId: players[2]!.id,
        accusation: "Duplicate nominator.",
      }),
    ).toThrow("already made a nomination today");

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[2]!.id,
        nomineeId: players[1]!.id,
        accusation: "Duplicate nominee.",
      }),
    ).toThrow("already been nominated today");
  });

  it("blocks ghosts from nominating", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[0]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[0]!.id,
        nomineeId: players[1]!.id,
        accusation: "Ghost accusation.",
      }),
    ).toThrow("Ghosts cannot nominate");
  });

  it("allows nominating a dead player", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[1]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    const events = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "The dead did it.",
    });
    expect(events.some((event) => event.type === GameEventType.NominationMade)).toBe(true);
    for (const event of events) engine.apply(event);
    expect(engine.getState().day?.nominations[0]?.nomineeId).toBe(players[1]!.id);
  });

  it("cycles town day → night → day and clears nominations on the new day", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Day 1 nomination.",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({ kind: GameCommandKind.ResolveNomination, gameId })) {
      engine.apply(event);
    }
    for (const event of engine.handle({ kind: GameCommandKind.CloseNominations, gameId })) {
      engine.apply(event);
    }
    expect(engine.getState().day?.nominationsOpen).toBe(false);

    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "night",
    })) {
      engine.apply(event);
    }

    expect(engine.getState().phase).toBe("night");
    expect(engine.getState().nightNumber).toBe(2);

    for (const event of engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId,
      targetPhase: "day",
    })) {
      engine.apply(event);
    }

    expect(engine.getState().phase).toBe("day");
    expect(engine.getState().dayNumber).toBe(2);
    expect(engine.getState().day?.nominations).toHaveLength(0);
    expect(engine.getState().day?.nominationsOpen).toBe(true);

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Day 2 nomination.",
    })) {
      engine.apply(event);
    }
    expect(engine.getState().day?.nominations).toHaveLength(1);
  });

  it("blocks entering night while a nomination is still open", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Still open.",
    })) {
      engine.apply(event);
    }

    expect(() =>
      engine.handle({
        kind: GameCommandKind.AdvancePhase,
        gameId,
        targetPhase: "night",
      }),
    ).toThrow("Resolve or clear open nominations");
  });

  it("allows storyteller duplicate nominations with allowDuplicate", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First.",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
    })) {
      engine.apply(event);
    }

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[0]!.id,
        nomineeId: players[2]!.id,
        accusation: "Second without override.",
      }),
    ).toThrow("already made a nomination today");

    const forced = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Forced re-nomination.",
      allowDuplicate: true,
    });
    expect(forced).toHaveLength(1);
    for (const event of forced) engine.apply(event);
    expect(engine.getState().day?.nominations).toHaveLength(2);
  });

  it("sets a 24h vote deadline on nominations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const engine = setupTownEngine(3);
    const [nominator, nominee] = engine.getState().players;
    const events = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: nominator!.id,
      nomineeId: nominee!.id,
      accusation: "Suspicious.",
    });
    for (const event of events) engine.apply(event);

    const nomination = engine.getState().day!.nominations[0]!;
    expect(nomination.voteDeadlineAt).toBe("2026-07-02T12:00:00.000Z");

    vi.useRealTimers();
  });

  it("rejects player votes after the nomination deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Late vote test.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    vi.setSystemTime(new Date("2026-07-02T12:00:01.000Z"));

    expect(() =>
      engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        nominationId: nomination.id,
        voterId: players[2]!.id,
        choice: "yes",
      }),
    ).toThrow("Voting has closed");

    vi.useRealTimers();
  });

  it("toggles player alive state with SetPlayerAlive", () => {
    const engine = setupTownEngine(3);
    const player = engine.getState().players[0]!;

    const deadEvents = engine.handle({
      kind: GameCommandKind.SetPlayerAlive,
      gameId,
      playerId: player.id,
      alive: false,
    });
    expect(deadEvents).toHaveLength(1);
    for (const event of deadEvents) engine.apply(event);
    expect(engine.getPlayerById(player.id)?.alive).toBe(false);

    const aliveEvents = engine.handle({
      kind: GameCommandKind.SetPlayerAlive,
      gameId,
      playerId: player.id,
      alive: true,
    });
    expect(aliveEvents).toHaveLength(1);
    for (const event of aliveEvents) engine.apply(event);
    expect(engine.getPlayerById(player.id)?.alive).toBe(true);

    expect(
      engine.handle({
        kind: GameCommandKind.SetPlayerAlive,
        gameId,
        playerId: player.id,
        alive: true,
      }),
    ).toHaveLength(0);
  });

  it("locks player votes until unlocked; ST set-vote still works", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Lock test.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const firstVote = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: players[2]!.id,
      choice: "yes",
    });
    for (const event of firstVote) engine.apply(event);

    const lockEvents = engine.handle({
      kind: GameCommandKind.LockNominationVotes,
      gameId,
      nominationId: nomination.id,
    });
    for (const event of lockEvents) engine.apply(event);
    expect(engine.getNominationById(nomination.id)?.votesLocked).toBe(true);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        nominationId: nomination.id,
        voterId: players[0]!.id,
        choice: "no",
      }),
    ).toThrow("Votes are locked");

    const override = engine.handle({
      kind: GameCommandKind.SetPlayerVote,
      gameId,
      nominationId: nomination.id,
      voterId: players[2]!.id,
      choice: "no",
    });
    for (const event of override) engine.apply(event);
    expect(engine.formatNominationVoteRoll(nomination.id)).toContain("no");
  });

  it("orders vote roll starting after the nominee by seat", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;
    // seats 1..4 = players[0]..[3]; nominee seat 2 → order: 3,4,1,2
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Order test.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const order = engine.getVoteLockInOrder(players[1]!.id).map((player) => player.seat);
    expect(order).toEqual([3, 4, 1, 2]);

    for (const [index, player] of engine.getVoteLockInOrder(players[1]!.id).entries()) {
      const events = engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        nominationId: nomination.id,
        voterId: player.id,
        choice: index % 2 === 0 ? "yes" : "no",
      });
      for (const event of events) engine.apply(event);
    }

    const roll = engine.formatNominationVoteRoll(nomination.id);
    const firstLine = roll.split("\n")[0]!;
    expect(firstLine).toContain(players[2]!.displayName);
    expect(firstLine).toContain("seat 3");
    expect(roll.split("\n").at(-1)).toContain(players[1]!.displayName);
  });

  it("counts votes one-by-one with yes/no and locks when finished", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Count test.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const start = engine.handle({
      kind: GameCommandKind.StartNominationCount,
      gameId,
      nominationId: nomination.id,
    });
    for (const event of start) engine.apply(event);
    expect(engine.getCountHandPlayer(nomination.id)?.id).toBe(players[2]!.id);

    const roll = engine.formatNominationVoteRoll(nomination.id, { audience: "storyteller" });
    expect(roll).toMatch(/^👉 \d+\./m);
    expect(roll).not.toMatch(/👉 \*\*/);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        nominationId: nomination.id,
        voterId: players[0]!.id,
        choice: "yes",
      }),
    ).toThrow("vote count is in progress");

    const eligible = engine.getCountEligiblePlayers(nomination.id);
    for (const [index, player] of eligible.entries()) {
      const events = engine.handle({
        kind: GameCommandKind.CountHandVote,
        gameId,
        nominationId: nomination.id,
        choice: index % 2 === 0 ? "yes" : "no",
      });
      for (const event of events) engine.apply(event);
      if (index < eligible.length - 1) {
        expect(engine.getCountHandPlayer(nomination.id)?.id).toBe(eligible[index + 1]!.id);
      }
    }

    expect(engine.getNominationById(nomination.id)?.votesLocked).toBe(true);
    expect(engine.getNominationById(nomination.id)?.countHandIndex).toBeNull();
    expect(engine.getCountHandPlayer(nomination.id)).toBeNull();
    expect(engine.formatNominationTally(nomination.id, { revealSecret: true })).toContain("Yes: 2");
  });

  it("does not skip the next player after a ghost votes yes during the count", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;
    // Kill seat-order player who sits between first and third in count order.
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[2]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Ghost in the circle.",
    })) {
      engine.apply(event);
    }
    const nomination = engine.getState().day!.nominations[0]!;

    // Count order after nominee (seat 2): seat3 ghost, seat4, seat1, seat2 nominee.
    expect(engine.getCountEligiblePlayers(nomination.id).map((player) => player.id)).toEqual([
      players[2]!.id,
      players[3]!.id,
      players[0]!.id,
      players[1]!.id,
    ]);

    for (const event of engine.handle({
      kind: GameCommandKind.StartNominationCount,
      gameId,
      nominationId: nomination.id,
    })) {
      engine.apply(event);
    }
    expect(engine.getCountHandPlayer(nomination.id)?.id).toBe(players[2]!.id);

    for (const event of engine.handle({
      kind: GameCommandKind.CountHandVote,
      gameId,
      nominationId: nomination.id,
      choice: "yes",
    })) {
      engine.apply(event);
    }

    expect(engine.getPlayerById(players[2]!.id)?.ghostVoteUsed).toBe(true);
    // Previously handIndex+1 into a shrunk eligible list skipped seat 4.
    expect(engine.getCountHandPlayer(nomination.id)?.id).toBe(players[3]!.id);
  });

  it("includes a ghost who pre-voted yes when starting the count", () => {
    const engine = setupTownEngine(4);
    const players = engine.getState().players;
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: players[2]!.id,
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Ghost pre-vote.",
    })) {
      engine.apply(event);
    }
    const nomination = engine.getState().day!.nominations[0]!;

    for (const event of engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: players[2]!.id,
      choice: "yes",
    })) {
      engine.apply(event);
    }
    expect(engine.getPlayerById(players[2]!.id)?.ghostVoteUsed).toBe(false);

    for (const event of engine.handle({
      kind: GameCommandKind.StartNominationCount,
      gameId,
      nominationId: nomination.id,
    })) {
      engine.apply(event);
    }

    expect(engine.getCountHandPlayer(nomination.id)?.id).toBe(players[2]!.id);
  });

  it("cancels an in-progress count without locking", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Cancel count.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    for (const event of engine.handle({
      kind: GameCommandKind.StartNominationCount,
      gameId,
      nominationId: nomination.id,
    })) {
      engine.apply(event);
    }

    for (const event of engine.handle({
      kind: GameCommandKind.CountHandVote,
      gameId,
      nominationId: nomination.id,
      choice: "yes",
    })) {
      engine.apply(event);
    }

    for (const event of engine.handle({
      kind: GameCommandKind.CancelNominationCount,
      gameId,
      nominationId: nomination.id,
    })) {
      engine.apply(event);
    }

    expect(engine.getNominationById(nomination.id)?.countHandIndex).toBeNull();
    expect(engine.getNominationById(nomination.id)?.votesLocked).toBe(false);
    expect(engine.formatNominationTally(nomination.id, { revealSecret: true })).toContain("Yes: 1");
  });

  it("treats equal majority tallies as a block tie", () => {
    const engine = setupTownEngine(5);
    const players = engine.getState().players;

    const makeAndLock = (nominator: number, nominee: number, yesVoters: number[]) => {
      for (const event of engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[nominator]!.id,
        nomineeId: players[nominee]!.id,
        accusation: "Block contest.",
      })) {
        engine.apply(event);
      }
      const nomination = engine.getState().day!.nominations.at(-1)!;
      for (const voter of yesVoters) {
        for (const event of engine.handle({
          kind: GameCommandKind.CastVote,
          gameId,
          nominationId: nomination.id,
          voterId: players[voter]!.id,
          choice: "yes",
        })) {
          engine.apply(event);
        }
      }
      for (const event of engine.handle({
        kind: GameCommandKind.LockNominationVotes,
        gameId,
        nominationId: nomination.id,
      })) {
        engine.apply(event);
      }
      return nomination;
    };

    const first = makeAndLock(0, 1, [0, 2, 3]);
    const sole = engine.getBlockContest();
    expect(sole.kind).toBe("sole");
    if (sole.kind === "sole") {
      expect(sole.leader.nominationId).toBe(first.id);
    }

    // Resolve first so the same players can nominate again? Wait - once per day rules block.
    // Second nominator/nominee must be different players.
    const second = makeAndLock(2, 3, [0, 2, 4]);
    const tied = engine.getBlockContest();
    expect(tied.kind).toBe("tie");
    if (tied.kind === "tie") {
      expect(tied.yesVotes).toBe(3);
      expect(tied.leaders.map((leader) => leader.nominationId).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    }
  });

  it("keeps ST-thread private ballots off the public roll and shows both on storyteller roll", () => {
    const engine = setupTownEngine(3);
    const players = engine.getState().players;
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Private ballot test.",
    })) {
      engine.apply(event);
    }
    const nomination = engine.getState().day!.nominations[0]!;
    const voter = players[2]!;

    for (const event of engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: voter.id,
      choice: "yes",
    })) {
      engine.apply(event);
    }

    for (const event of engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: voter.id,
      choice: "no",
      privateBallot: true,
    })) {
      engine.apply(event);
    }

    expect(engine.formatNominationTally(nomination.id, { ballot: "public" })).toContain("Yes: 1");
    expect(engine.formatNominationTally(nomination.id, { ballot: "public" })).toContain("No: 0");
    expect(engine.formatNominationVoteRoll(nomination.id, { audience: "public" })).toContain(
      "**yes**",
    );
    expect(engine.formatNominationVoteRoll(nomination.id, { audience: "public" })).not.toContain(
      "**no**",
    );

    const stRoll = engine.formatNominationVoteRoll(nomination.id, { audience: "storyteller" });
    expect(stRoll).toContain(`**no**`);
    expect(stRoll).toContain("(public: yes)");
  });
});

describe("vote thresholds", () => {
  it("needs half the living players rounded up to reach the block", () => {
    expect(votesNeededOnTheBlock(4)).toBe(2);
    expect(passesExecutionVote(2, 4)).toBe(true);
    expect(passesExecutionVote(1, 4)).toBe(false);

    expect(votesNeededOnTheBlock(5)).toBe(3);
    expect(passesExecutionVote(3, 5)).toBe(true);
    expect(passesExecutionVote(2, 5)).toBe(false);
  });
});

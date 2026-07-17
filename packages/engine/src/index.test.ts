import { describe, expect, it, vi } from "vitest";
import { GameEngine, GameCommandKind, GameEventType, type GameEvent, DEV_MIN_PLAYERS, resolveStandardScript, StandardEdition } from "./index.js";

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

    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "Accusation.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    const firstVote = engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      voterId: players[2]!.id,
      nominationId: nomination.id,
      choice: "yes",
    });
    for (const event of firstVote) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        voterId: players[2]!.id,
        nominationId: nomination.id,
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

  function setupTownEngine(playerCount = 4): GameEngine {
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

  it("sets up town with ordered seats and townMode", () => {
    const engine = setupTownEngine(3);
    const state = engine.getState();

    expect(state.phase).toBe("day");
    expect(state.dayNumber).toBe(1);
    expect(state.townMode).toBe(true);
    expect(state.players).toHaveLength(3);
    expect(state.players.map((player) => player.seat)).toEqual([1, 2, 3]);
    expect(state.players.every((player) => player.alive && !player.roleId)).toBe(true);
    expect(state.day?.nominationsOpen).toBe(true);
    expect(state.day?.discordThreadId).toBeNull();
  });

  it("allows town-mode nominations again after prior nominations are resolved", () => {
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

    const second = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[2]!.id,
      accusation: "Second accusation.",
    });
    expect(second).toHaveLength(1);
    for (const event of second) engine.apply(event);
    expect(engine.getState().day?.nominations).toHaveLength(2);
  });

  it("blocks town-mode nominations only while another is open", () => {
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
    ).toThrow("open nomination");

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[2]!.id,
        nomineeId: players[1]!.id,
        accusation: "Duplicate nominee.",
      }),
    ).toThrow("open nomination");
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
});

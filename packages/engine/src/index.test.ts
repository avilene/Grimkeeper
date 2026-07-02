import { describe, expect, it } from "vitest";
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
    });
    for (const event of events) engine.apply(event);

    expect(engine.getState().nominations).toHaveLength(1);
    expect(engine.formatNomination(engine.getState().nominations[0]!)).toContain("nominates");
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

    expect(engine.getState().nominations).toHaveLength(0);
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
    });
    for (const event of first) engine.apply(event);

    expect(() =>
      engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId,
        nominatorId: players[2]!.id,
        nomineeId: players[1]!.id,
      }),
    ).toThrow("already been nominated");
  });
});

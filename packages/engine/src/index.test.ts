import { describe, expect, it } from "vitest";
import { GameEngine, type GameEvent } from "./index.js";

const gameId = "game-1";

function baseEvents(): GameEvent[] {
  return [
    {
      type: "GameCreated",
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
      timestamp: new Date().toISOString(),
    },
  ];
}

function withPlayers(count: number): GameEvent[] {
  const events = baseEvents();
  for (let i = 0; i < count; i++) {
    events.push({
      type: "PlayerAdded",
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
  });

  it("starts a game and deals roles", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(5));
    const emitted = engine.handle({
      kind: "StartGame",
      gameId,
      roleAssignments: engine.getState().players.map((player, index) => ({
        playerId: player.id,
        roleId: index === 0 ? "imp" : "washerwoman",
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

  it("builds grim reveal lines", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(2));
    engine.apply({
      type: "RolesDealt",
      gameId,
      assignments: engine.getState().players.map((player) => ({
        playerId: player.id,
        roleId: "washerwoman",
      })),
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: "GameEnded",
      gameId,
      winner: "good",
      reason: "Demon executed",
      timestamp: new Date().toISOString(),
    });

    const reveal = engine.getGrimReveal();
    expect(reveal.some((line) => line.includes("washerwoman"))).toBe(true);
    expect(reveal.some((line) => line.includes("Winner: good"))).toBe(true);
  });
});

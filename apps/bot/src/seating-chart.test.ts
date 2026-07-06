import { describe, expect, it } from "vitest";
import {
  GameEngine,
  GameCommandKind,
  GameEventType,
  type GameEvent,
  resolveStandardScript,
  StandardEdition,
} from "@grimkeeper/engine";

import {
  buildSeatingChartLines,
  buildSeatingEmbed,
  seatingChartFooter,
} from "./seating-chart.js";

const gameId = "game-seating";
const script = resolveStandardScript(StandardEdition.TB);

function withPlayers(count: number): GameEvent[] {
  const events: GameEvent[] = [
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

function setupPhaseEngine(playerCount = 3): GameEngine {
  const engine = GameEngine.fromEvents(gameId, withPlayers(playerCount));
  engine.apply({
    type: GameEventType.GameStarted,
    gameId,
    timestamp: new Date().toISOString(),
  });
  return engine;
}

describe("seatingChartFooter", () => {
  it("uses a stable grimkeeper footer prefix", () => {
    expect(seatingChartFooter("abc-123")).toBe("grimkeeper:seating:abc-123");
  });
});

describe("buildSeatingChartLines", () => {
  it("shows empty seats and unseated players during setup", () => {
    const engine = setupPhaseEngine(3);
    engine.apply({
      type: GameEventType.SeatsOpened,
      gameId,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.SeatPicked,
      gameId,
      playerId: "player-1",
      seat: 2,
      timestamp: new Date().toISOString(),
    });

    const lines = buildSeatingChartLines(engine);
    expect(lines).toContain("**Seat 1:** —");
    expect(lines).toContain("**Seat 2:** <@user-1>");
    expect(lines.some((line) => line.includes("Unseated"))).toBe(true);
    expect(lines.some((line) => line.includes("<@user-2>"))).toBe(true);
  });

  it("labels fake players without mentions", () => {
    const engine = GameEngine.fromEvents(gameId, [
      ...withPlayers(1),
      {
        type: GameEventType.PlayerAdded,
        gameId,
        playerId: "fake-1",
        discordUserId: "dev:game-seating:1",
        displayName: "Dev Player 1",
        timestamp: new Date().toISOString(),
      },
    ]);
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
    engine.apply({
      type: GameEventType.SeatPicked,
      gameId,
      playerId: "fake-1",
      seat: 1,
      timestamp: new Date().toISOString(),
    });

    const lines = buildSeatingChartLines(engine);
    expect(lines).toContain("**Seat 1:** Dev Player 1 *(fake)*");
  });
});

describe("buildSeatingEmbed", () => {
  it("shows open status when seat selection is open", () => {
    const engine = setupPhaseEngine(2);
    engine.apply({
      type: GameEventType.SeatsOpened,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const embed = buildSeatingEmbed(engine).toJSON();
    expect(embed.title).toBe("Seating chart");
    expect(embed.description).toContain("Seat selection is **open**");
    expect(embed.footer?.text).toBe(seatingChartFooter(gameId));
  });

  it("shows closed status when everyone is seated", () => {
    const engine = setupPhaseEngine(2);
    engine.apply({
      type: GameEventType.SeatsOpened,
      gameId,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.SeatPicked,
      gameId,
      playerId: "player-1",
      seat: 1,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.SeatPicked,
      gameId,
      playerId: "player-2",
      seat: 2,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.SeatsClosed,
      gameId,
      timestamp: new Date().toISOString(),
    });

    const embed = buildSeatingEmbed(engine).toJSON();
    expect(embed.description).toContain("Seat selection is **closed**. Everyone is seated.");
    expect(embed.description).toContain("**Seat 1:** <@user-1>");
  });
});

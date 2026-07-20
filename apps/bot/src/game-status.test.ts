import { describe, expect, it } from "vitest";
import {
  GameEngine,
  GameEventType,
  type GameEvent,
  resolveStandardScript,
  StandardEdition,
} from "@grimkeeper/engine";

import { buildAliveDeadLines, gameStatusFooter } from "./game-status.js";

const gameId = "game-status";
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

describe("gameStatusFooter", () => {
  it("uses a stable footer prefix", () => {
    expect(gameStatusFooter("abc")).toBe("grimkeeper:status:abc");
  });
});

describe("buildAliveDeadLines", () => {
  it("lists alive and dead players separately", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: "player-3",
      cause: "night",
      timestamp: new Date().toISOString(),
    });

    const { alive, dead } = buildAliveDeadLines(engine);
    expect(alive).toContain("<@user-1>");
    expect(alive).toContain("<@user-2>");
    expect(dead).toContain("<@user-3>");
    expect(dead).toContain("ghost **available**");
  });

  it("keeps ghost available after a pre-vote yes until the count", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 1,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.PlayerDied,
      gameId,
      playerId: "player-3",
      cause: "night",
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.NominationMade,
      gameId,
      nominationId: "nom-1",
      nominatorId: "player-1",
      nomineeId: "player-2",
      accusation: "test",
      order: 1,
      timestamp: new Date().toISOString(),
    });
    engine.apply({
      type: GameEventType.VoteCast,
      gameId,
      nominationId: "nom-1",
      voterId: "player-3",
      choice: "yes",
      reason: null,
      timestamp: new Date().toISOString(),
    });

    const { dead, daySummary } = buildAliveDeadLines(engine);
    expect(dead).toContain("ghost **available**");
    expect(daySummary).toContain("Ghost votes left: **1**");
  });

  it("includes day nomination summary during day phase", () => {
    const engine = GameEngine.fromEvents(gameId, withPlayers(3));
    engine.apply({
      type: GameEventType.DayStarted,
      gameId,
      dayNumber: 2,
      timestamp: new Date().toISOString(),
    });

    const { daySummary } = buildAliveDeadLines(engine);
    expect(daySummary).toContain("Day **2**");
    expect(daySummary).toContain("Nominations:");
  });
});

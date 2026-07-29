import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_BOT_GAME_SIZE,
  buildDevBotRoster,
  buildMixedDevRoster,
} from "./dev-bot-game.js";
import { fakePlayerId, fakePlayerName } from "@grimkeeper/engine";

describe("buildDevBotRoster", () => {
  it("builds N fake players with dev ids", () => {
    const roster = buildDevBotRoster("game-abc", 8);
    expect(roster).toHaveLength(8);
    expect(roster[0]).toMatchObject({
      discordUserId: fakePlayerId("game-abc", 1),
      displayName: fakePlayerName(1),
    });
    expect(roster[7]?.discordUserId).toBe(fakePlayerId("game-abc", 8));
    const ids = new Set(roster.map((p) => p.playerId));
    expect(ids.size).toBe(8);
  });

  it("defaults to 8 in constant", () => {
    expect(DEFAULT_DEV_BOT_GAME_SIZE).toBe(8);
  });
});

describe("buildMixedDevRoster", () => {
  it("places real players first then fills with bots", () => {
    const roster = buildMixedDevRoster("game-abc", 5, [
      { discordUserId: "111", displayName: "Alice" },
      { discordUserId: "222", displayName: "Bob" },
    ]);
    expect(roster).toHaveLength(5);
    expect(roster[0]).toMatchObject({ discordUserId: "111", displayName: "Alice" });
    expect(roster[1]).toMatchObject({ discordUserId: "222", displayName: "Bob" });
    expect(roster[2]?.discordUserId).toBe(fakePlayerId("game-abc", 1));
    expect(roster[4]?.discordUserId).toBe(fakePlayerId("game-abc", 3));
  });

  it("rejects more real players than table size", () => {
    expect(() =>
      buildMixedDevRoster("game-abc", 3, [
        { discordUserId: "1", displayName: "A" },
        { discordUserId: "2", displayName: "B" },
        { discordUserId: "3", displayName: "C" },
        { discordUserId: "4", displayName: "D" },
      ]),
    ).toThrow(/too many real players/i);
  });
});

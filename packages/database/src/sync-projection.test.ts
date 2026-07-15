import { describe, expect, it } from "vitest";
import { createEmptyDayState, type GameState } from "@grimkeeper/engine";

import { shouldSyncDayState } from "./sync-projection.js";

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: "game-1",
    guildId: "guild-1",
    channelId: "channel-1",
    phase: "day",
    storytellerId: "st-1",
    promotedStorytellerIds: [],
    script: null,
    nightNumber: 1,
    dayNumber: 1,
    players: [],
    day: createEmptyDayState(1),
    seatsOpen: false,
    townMode: false,
    winner: null,
    ...overrides,
  };
}

describe("shouldSyncDayState", () => {
  it("returns true during day phase with day state", () => {
    expect(shouldSyncDayState(baseState())).toBe(true);
  });

  it("returns false outside day phase", () => {
    expect(shouldSyncDayState(baseState({ phase: "night", day: createEmptyDayState(1) }))).toBe(false);
    expect(shouldSyncDayState(baseState({ phase: "day", day: null }))).toBe(false);
  });
});

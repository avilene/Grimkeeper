import { describe, expect, it } from "vitest";

import {
  areSeatedNeighbors,
  defaultGroupWhisperName,
  defaultPairWhisperName,
  formatWhisperDayMarker,
  formatWhisperDeclaration,
  formatWhisperOpenMessage,
  formatWhisperReusePing,
  getSeatedNeighborPlayers,
  resolveWhisperThreadName,
} from "./whisper-thread.js";

describe("whisper thread helpers", () => {
  it("defaults pair and group names", () => {
    expect(defaultPairWhisperName("Alice", "Bob", false)).toBe("Alice & Bob");
    expect(defaultPairWhisperName("Alice", "Bob", true)).toBe("Alice & Bob NW");
    expect(defaultGroupWhisperName(["Alice", "Bob", "Carol"])).toBe("Group (Alice, Bob, Carol)");
  });

  it("resolves custom and default thread names", () => {
    expect(
      resolveWhisperThreadName({
        name: "Secrets",
        neighbor: true,
        displayNames: ["Alice", "Bob"],
      }),
    ).toBe("Secrets NW");
    expect(
      resolveWhisperThreadName({
        neighbor: false,
        displayNames: ["Alice", "Bob", "Carol"],
      }),
    ).toBe("Group (Alice, Bob, Carol)");
  });

  it("formats day markers and open messages", () => {
    expect(formatWhisperDayMarker(2)).toBe("## Day 2");
    expect(formatWhisperOpenMessage(["1", "2"], "day", 1)).toContain("## Day 1");
    expect(formatWhisperOpenMessage(["1", "2"], "day", 1)).toContain("<@1>");
    expect(formatWhisperOpenMessage(["1", "2"], "day", 1)).toContain("Storyteller can see");
    expect(formatWhisperOpenMessage(["1", "2"], "night", 3)).toContain("## Night 3");
  });

  it("detects seated circle neighbors", () => {
    expect(areSeatedNeighbors({ seat: 1 }, { seat: 2 }, 5)).toBe(true);
    expect(areSeatedNeighbors({ seat: 5 }, { seat: 1 }, 5)).toBe(true);
    expect(areSeatedNeighbors({ seat: 1 }, { seat: 3 }, 5)).toBe(false);
    expect(areSeatedNeighbors({ seat: null }, { seat: 2 }, 5)).toBe(false);
    expect(areSeatedNeighbors({ seat: 1 }, { seat: 1 }, 5)).toBe(false);
  });

  it("lists left/right neighbors from seats", () => {
    const players = [
      { id: "a", seat: 1, discordUserId: "1", displayName: "A", roleId: null, alive: true, isFake: false, ghostVoteUsed: false, hasTwoVotes: false },
      { id: "b", seat: 2, discordUserId: "2", displayName: "B", roleId: null, alive: true, isFake: false, ghostVoteUsed: false, hasTwoVotes: false },
      { id: "c", seat: 3, discordUserId: "3", displayName: "C", roleId: null, alive: true, isFake: false, ghostVoteUsed: false, hasTwoVotes: false },
    ];
    const neighbors = getSeatedNeighborPlayers(players[0]!, players);
    expect(neighbors.map((p) => p.id).sort()).toEqual(["b", "c"]);
  });

  it("formats reuse pings and declarations", () => {
    expect(formatWhisperReusePing(["1", "2"])).toBe("<@1> <@2> — whisper resumed.");
    expect(formatWhisperDeclaration(["Alice", "Bob"])).toBe(
      "Whisper created between Alice and Bob",
    );
    expect(formatWhisperDeclaration(["Alice", "Bob"], true)).toBe(
      "Neighbor whisper created between Alice and Bob",
    );
    expect(formatWhisperDeclaration(["Alice", "Bob", "Carol"])).toBe(
      "Whisper created between Alice, Bob, Carol",
    );
  });
});

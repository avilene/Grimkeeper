import { describe, expect, it } from "vitest";

import { aggregatePlayerStats } from "./player-stats.js";

describe("aggregatePlayerStats", () => {
  it("computes win rate excluding travelers and null team", () => {
    const stats = aggregatePlayerStats([
      { roleId: "washerwoman", team: "good", winner: "good" },
      { roleId: "imp", team: "evil", winner: "good" },
      { roleId: "bureaucrat", team: "traveler", winner: "good" },
      { roleId: "monk", team: null, winner: "evil" },
    ]);

    expect(stats.gamesPlayed).toBe(4);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(2); // imp loss + monk (derived good) vs evil
    expect(stats.winRate).toBeCloseTo(1 / 3);
    expect(stats.travelerGames).toBe(1);
    expect(stats.unalignedGames).toBe(0); // monk derives good from catalog
    expect(stats.goodGames).toBe(2);
    expect(stats.evilGames).toBe(1);
  });

  it("counts truly unaligned when role has no catalog team", () => {
    const stats = aggregatePlayerStats([
      { roleId: "custom-unknown", team: null, winner: "good" },
    ]);
    expect(stats.unalignedGames).toBe(1);
    expect(stats.winRate).toBeNull();
  });

  it("ranks most-played characters", () => {
    const stats = aggregatePlayerStats([
      { roleId: "imp", team: "evil", winner: "evil" },
      { roleId: "imp", team: "evil", winner: "good" },
      { roleId: "washerwoman", team: "good", winner: "good" },
    ]);

    expect(stats.topCharacters[0]).toMatchObject({ roleId: "imp", count: 2 });
    expect(stats.topCharacters[1]).toMatchObject({ roleId: "washerwoman", count: 1 });
  });

  it("returns null win rate when nothing is scorable", () => {
    const stats = aggregatePlayerStats([
      { roleId: "bureaucrat", team: "traveler", winner: "good" },
    ]);
    expect(stats.winRate).toBeNull();
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
  });
});

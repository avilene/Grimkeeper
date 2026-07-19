import { describe, expect, it } from "vitest";
import type { PlayerState } from "@grimkeeper/engine";

import {
  filterPlayersForAutocomplete,
  normalizePlayerAutocompleteQuery,
  playerMatchesAutocompleteQuery,
} from "./command-context.js";

function player(partial: Partial<PlayerState> & Pick<PlayerState, "id" | "discordUserId" | "displayName">): PlayerState {
  return {
    seat: null,
    roleId: null,
    alive: true,
    isFake: false,
    ghostVoteUsed: false,
    ...partial,
  };
}

describe("normalizePlayerAutocompleteQuery", () => {
  it("strips @ and mention markup", () => {
    expect(normalizePlayerAutocompleteQuery("  @Alice  ")).toBe("alice");
    expect(normalizePlayerAutocompleteQuery("<@123456789012345678>")).toBe("123456789012345678");
    expect(normalizePlayerAutocompleteQuery("<@!123456789012345678>")).toBe("123456789012345678");
  });
});

describe("playerMatchesAutocompleteQuery", () => {
  const alice = player({
    id: "p1",
    discordUserId: "111",
    displayName: "Alice",
    seat: 3,
  });

  it("matches name, id, and seat forms", () => {
    expect(playerMatchesAutocompleteQuery(alice, "ali")).toBe(true);
    expect(playerMatchesAutocompleteQuery(alice, "111")).toBe(true);
    expect(playerMatchesAutocompleteQuery(alice, "3")).toBe(true);
    expect(playerMatchesAutocompleteQuery(alice, "seat 3")).toBe(true);
    expect(playerMatchesAutocompleteQuery(alice, "#3")).toBe(true);
    expect(playerMatchesAutocompleteQuery(alice, "bob")).toBe(false);
  });
});

describe("filterPlayersForAutocomplete", () => {
  const roster = [
    player({ id: "p1", discordUserId: "111", displayName: "Alice", seat: 1 }),
    player({ id: "p2", discordUserId: "222", displayName: "Bob", seat: 2, alive: false }),
    player({ id: "p3", discordUserId: "333", displayName: "Carol", seat: 3 }),
  ];

  it("returns all living nominees excluding self for nominate", () => {
    const matches = filterPlayersForAutocomplete(
      roster,
      { excludeUserId: "111" },
      "",
    );
    expect(matches.map((p) => p.displayName)).toEqual(["Bob", "Carol"]);
  });

  it("filters by typed name without requiring Discord role membership", () => {
    const matches = filterPlayersForAutocomplete(roster, {}, "@car");
    expect(matches.map((p) => p.displayName)).toEqual(["Carol"]);
  });

  it("limits open-nominee vote search", () => {
    const matches = filterPlayersForAutocomplete(
      roster,
      { openNomineesOnly: true, openNomineeIds: new Set(["p1"]) },
      "ali",
    );
    expect(matches.map((p) => p.displayName)).toEqual(["Alice"]);
  });
});

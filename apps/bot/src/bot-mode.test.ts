import { describe, expect, it } from "vitest";

import { MINIMAL_MIN_PLAYERS, minPlayersForMode } from "./bot-mode.js";

describe("minPlayersForMode", () => {
  it("returns 0 (no minimum player gate)", () => {
    expect(minPlayersForMode()).toBe(MINIMAL_MIN_PLAYERS);
    expect(MINIMAL_MIN_PLAYERS).toBe(0);
  });
});

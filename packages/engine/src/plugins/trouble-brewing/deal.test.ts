import { describe, expect, it } from "vitest";
import { dealTroubleBrewingRoles, getTroubleBrewingComposition } from "./deal.js";
import { troubleBrewingRoles } from "./roles.js";

describe("Trouble Brewing deal", () => {
  it("uses official composition for 8 players", () => {
    expect(getTroubleBrewingComposition(8)).toEqual({
      townsfolk: 5,
      outsider: 1,
      minion: 1,
      demon: 1,
    });
  });

  it("deals the correct role counts for 8 players", () => {
    const roles = dealTroubleBrewingRoles(8);
    expect(roles).toHaveLength(8);

    const byType = (type: string) =>
      roles.filter((id) => troubleBrewingRoles.find((role) => role.id === id)?.type === type).length;

    expect(byType("demon")).toBe(1);
    expect(byType("minion")).toBe(1);
    expect(byType("outsider")).toBe(1);
    expect(byType("townsfolk")).toBe(5);
  });

  it("supports reduced dev compositions", () => {
    const roles = dealTroubleBrewingRoles(3, { devMode: true });
    expect(roles).toHaveLength(3);
    expect(roles.some((id) => id === "imp")).toBe(true);
  });
});

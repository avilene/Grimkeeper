import { describe, expect, it } from "vitest";

import {
  abilityHasNightAsterisk,
  formatBotcAbility,
  formatBotcEdition,
  getBotcIconUrl,
  getBotcRole,
  listBotcRoles,
  searchBotcRoles,
} from "./botc-catalog.js";

describe("botc catalog", () => {
  it("includes base scripts and travelers", () => {
    const roles = listBotcRoles();
    expect(roles.length).toBeGreaterThanOrEqual(100);
    expect(roles.some((role) => role.team === "traveler")).toBe(true);
    expect(getBotcRole("washerwoman")?.name).toBe("Washerwoman");
    expect(getBotcRole("Bureaucrat")?.team).toBe("traveler");
    expect(formatBotcEdition("tb")).toBe("Trouble Brewing");
    expect(formatBotcEdition("")).toBeNull();
  });

  it("fuzzy-matches character names", () => {
    const washer = searchBotcRoles("wash");
    expect(washer[0]?.role.id).toBe("washerwoman");

    const scarlet = searchBotcRoles("scarlet");
    expect(scarlet[0]?.role.name.toLowerCase()).toContain("scarlet");

    const pithag = searchBotcRoles("pit hag");
    expect(pithag[0]?.role.id).toBe("pithag");
  });

  it("requires at least 3 characters", () => {
    expect(searchBotcRoles("")).toEqual([]);
    expect(searchBotcRoles("w")).toEqual([]);
    expect(searchBotcRoles("wa")).toEqual([]);
    expect(searchBotcRoles("was").length).toBeGreaterThan(0);
  });

  it("still resolves exact short role ids", () => {
    expect(searchBotcRoles("po")[0]?.role.id).toBe("po");
  });

  it("adds a not-first-night byline for night* abilities", () => {
    const undertaker = getBotcRole("undertaker");
    expect(undertaker).toBeTruthy();
    expect(abilityHasNightAsterisk(undertaker!.ability)).toBe(true);
    expect(formatBotcAbility(undertaker!.ability)).toContain("Not the first night");

    const washer = getBotcRole("washerwoman")!;
    expect(abilityHasNightAsterisk(washer.ability)).toBe(false);
    expect(formatBotcAbility(washer.ability)).toBe(washer.ability);
  });

  it("builds wiki icon urls from role ids", () => {
    expect(getBotcIconUrl(getBotcRole("washerwoman")!)).toContain("Icon_washerwoman.png");
  });
});

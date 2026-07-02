import { describe, expect, it } from "vitest";
import { getRoleImageUrl, getRoleWikiUrl } from "./images.js";

describe("role images", () => {
  it("builds official good-aligned townfolk image URLs", () => {
    expect(getRoleImageUrl("washerwoman")).toBe(
      "https://release.botc.app/resources/characters/tb/washerwoman_g.webp",
    );
  });

  it("maps underscore role ids to official asset ids", () => {
    expect(getRoleImageUrl("fortune_teller")).toBe(
      "https://release.botc.app/resources/characters/tb/fortuneteller_g.webp",
    );
    expect(getRoleImageUrl("scarlet_woman")).toBe(
      "https://release.botc.app/resources/characters/tb/scarletwoman_e.webp",
    );
  });

  it("builds wiki URLs from role names", () => {
    expect(getRoleWikiUrl("fortune_teller")).toBe(
      "https://wiki.bloodontheclocktower.com/Fortune_Teller",
    );
  });
});

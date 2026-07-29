import { describe, expect, it } from "vitest";

import {
  buffetPickCustomId,
  buffetMulliganCustomId,
  parseBuffetPickCustomId,
  parseBuffetMulliganCustomId,
  isBuffetInteraction,
  buildBuffetOfferMessage,
} from "./buffet-draft.js";

const gameId = "6911cd74-25ba-46f5-a57f-e9420bc219af";

describe("buffet custom IDs", () => {
  it("round-trips pick custom ids", () => {
    const id = buffetPickCustomId(gameId, "washerwoman");
    expect(id).toBe(`gk:buffet:pick:${gameId}|washerwoman`);
    expect(parseBuffetPickCustomId(id)).toEqual({ gameId, roleId: "washerwoman" });
  });

  it("round-trips mulligan custom ids", () => {
    const id = buffetMulliganCustomId(gameId);
    expect(id).toBe(`gk:buffet:mulligan:${gameId}`);
    expect(parseBuffetMulliganCustomId(id)).toEqual({ gameId });
  });

  it("isBuffetInteraction detects both prefixes", () => {
    expect(isBuffetInteraction(buffetPickCustomId(gameId, "imp"))).toBe(true);
    expect(isBuffetInteraction(buffetMulliganCustomId(gameId))).toBe(true);
    expect(isBuffetInteraction("gk:vote:yes")).toBe(false);
  });

  it("rejects malformed pick ids", () => {
    expect(parseBuffetPickCustomId("gk:buffet:pick:nopic")).toBeNull();
    expect(parseBuffetPickCustomId("gk:other")).toBeNull();
  });
});

describe("buildBuffetOfferMessage", () => {
  it("includes a button per role and a mulligan when steps remain", () => {
    const { content, components } = buildBuffetOfferMessage(
      ["washerwoman", "librarian", "imp"],
      gameId,
      0,
      3,
    );
    expect(content).toMatch(/Sushi Buffet/i);
    // Role buttons + mulligan row
    expect(components.length).toBeGreaterThanOrEqual(2);
    const allCustomIds = components.flatMap((row) =>
      row.components.map((c) => ("data" in c ? (c as { data: { custom_id?: string } }).data.custom_id : undefined)),
    );
    expect(allCustomIds).toContain(buffetPickCustomId(gameId, "washerwoman"));
    expect(allCustomIds).toContain(buffetMulliganCustomId(gameId));
  });

  it("uses ST-facing header when picking for a bot", () => {
    const { content } = buildBuffetOfferMessage(
      ["washerwoman", "librarian", "imp"],
      gameId,
      0,
      3,
      { drafterName: "Dev Player 1", forStoryteller: true },
    );
    expect(content).toMatch(/pick for Dev Player 1/i);
    expect(content).toMatch(/bot/i);
  });

  it("omits mulligan button on last step", () => {
    const { components } = buildBuffetOfferMessage(["imp"], gameId, 2, 3);
    const allCustomIds = components.flatMap((row) =>
      row.components.map((c) => ("data" in c ? (c as { data: { custom_id?: string } }).data.custom_id : undefined)),
    );
    expect(allCustomIds).not.toContain(buffetMulliganCustomId(gameId));
  });
});

import { describe, expect, it } from "vitest";

import {
  buffetPickCustomId,
  buffetMulliganCustomId,
  buffetTrackerFooter,
  parseBuffetPickCustomId,
  parseBuffetMulliganCustomId,
  parseBuffetTrackerFooter,
  isBuffetInteraction,
  buildBuffetOfferMessage,
  formatBuffetCompletionSummary,
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

  it("round-trips draft tracker footer game ids", () => {
    expect(parseBuffetTrackerFooter(buffetTrackerFooter(gameId))).toBe(gameId);
    expect(parseBuffetTrackerFooter("grimkeeper:vote-tracker:x")).toBeNull();
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

  it("uses the same offer message for all drafters", () => {
    const { content } = buildBuffetOfferMessage(
      ["washerwoman", "librarian", "imp"],
      gameId,
      0,
      3,
    );
    expect(content).toMatch(/choose your role/i);
    expect(content).not.toMatch(/pick for/i);
  });

  it("uses a Lil' Monsta follow-up intro for minion choice", () => {
    const { content } = buildBuffetOfferMessage(
      ["poisoner", "baron"],
      gameId,
      0,
      3,
      "lilmonsta-minion",
    );
    expect(content).toMatch(/Lil' Monsta/i);
    expect(content).toMatch(/Minion/i);
  });

  it("omits mulligan button on last step", () => {
    const { components } = buildBuffetOfferMessage(["imp"], gameId, 2, 3);
    const allCustomIds = components.flatMap((row) =>
      row.components.map((c) =>
        "data" in c ? (c as { data: { custom_id?: string } }).data.custom_id : undefined,
      ),
    );
    expect(allCustomIds).not.toContain(buffetMulliganCustomId(gameId));
  });
});

describe("formatBuffetCompletionSummary", () => {
  it("lists every picked role in seat order", () => {
    const engine = {
      getState: () => ({
        players: [
          { id: "p2", displayName: "Bram", seat: 2 },
          { id: "p1", displayName: "Ada", seat: 1 },
        ],
        buffetDraft: {
          picks: { p1: "washerwoman", p2: "imp" },
          beliefs: {},
          remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
          config: { enabledRoleIds: ["washerwoman", "imp"] },
          secretAssignments: {},
        },
      }),
    } as never;

    expect(formatBuffetCompletionSummary(engine)).toBe(
      "**Sushi Buffet — roles chosen**\n• seat 1 · **Ada** → Washerwoman\n• seat 2 · **Bram** → Imp\n\n_clocktower.live:_ `/st do buffet-export-clocktower`",
    );
  });

  it("mentions drunk need only when drunk is enabled and outsider slots remain", () => {
    const engine = {
      getState: () => ({
        players: [{ id: "p1", displayName: "Ada", seat: 1 }],
        buffetDraft: {
          picks: { p1: "washerwoman" },
          beliefs: {},
          remainingSlots: { townsfolk: 0, outsider: 1, minion: 0, demon: 0 },
          config: { enabledRoleIds: ["washerwoman", "drunk", "baron"] },
          secretAssignments: {},
        },
      }),
    } as never;

    const text = formatBuffetCompletionSummary(engine);
    expect(text).toContain("**Ada** → Washerwoman");
    expect(text).toMatch(/Need Drunk/i);
  });

  it("omits drunk hint when drunk is not in the selector", () => {
    const engine = {
      getState: () => ({
        players: [{ id: "p1", displayName: "Ada", seat: 1 }],
        buffetDraft: {
          picks: { p1: "washerwoman" },
          beliefs: {},
          remainingSlots: { townsfolk: 0, outsider: 2, minion: 0, demon: 0 },
          config: { enabledRoleIds: ["washerwoman", "baron"] },
          secretAssignments: {},
        },
      }),
    } as never;

    expect(formatBuffetCompletionSummary(engine)).not.toMatch(/Drunk/i);
  });

  it("lists unchosen outsiders when hermit was drafted", () => {
    const engine = {
      getState: () => ({
        players: [
          { id: "p1", displayName: "Ada", seat: 1 },
          { id: "p2", displayName: "Bram", seat: 2 },
        ],
        buffetDraft: {
          picks: { p1: "hermit", p2: "imp" },
          beliefs: {},
          remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
          config: {
            enabledRoleIds: ["hermit", "butler", "recluse", "imp"],
          },
          secretAssignments: {},
        },
      }),
    } as never;

    const text = formatBuffetCompletionSummary(engine);
    expect(text).toContain("**Ada** → Hermit");
    expect(text).toMatch(/unchosen Outsiders/i);
    expect(text).toMatch(/Butler/i);
    expect(text).toMatch(/Recluse/i);
  });
});

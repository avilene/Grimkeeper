import { describe, expect, it } from "vitest";
import {
  buildClocktowerLiveGamestate,
  serializeClocktowerLiveGamestate,
} from "./clocktower-live-export.js";
import { defaultBuffetConfig } from "./buffet-draft.js";

describe("buildClocktowerLiveGamestate", () => {
  const config = {
    ...defaultBuffetConfig(),
    enabledRoleIds: ["washerwoman", "butler", "imp", "poisoner", "lunatic"],
  };

  it("matches clocktower.live shape with script roles and seated players", () => {
    const state = buildClocktowerLiveGamestate({
      config,
      players: [
        { id: "p1", displayName: "Ada", seat: 1, alive: true },
        { id: "p2", displayName: "Bram", seat: 2, alive: true },
      ],
      draft: {
        picks: { p1: "washerwoman", p2: "imp" },
        beliefs: {},
        secretAssignments: {},
        inPlayDemon: null,
      },
    });

    expect(state.edition.id).toBe("custom");
    expect(state.roles).toEqual(
      expect.arrayContaining([{ id: "washerwoman" }, { id: "imp" }]),
    );
    expect(state.players).toHaveLength(2);
    expect(state.players[0]?.name).toBe("Ada");
    expect(state.players[0]?.role).toBe("washerwoman");
    expect(state.players[1]?.role).toBe("imp");
    expect(state.players[1]?.alignmentIndex).toBe(1);
    expect(state.bluffs).toEqual([null, null, null]);
  });

  it("shows belief on token and true role as reminder", () => {
    const state = buildClocktowerLiveGamestate({
      config,
      players: [{ id: "p1", displayName: "Ada", seat: 1, alive: true }],
      draft: {
        picks: { p1: "lunatic" },
        beliefs: { p1: "imp" },
        secretAssignments: { p1: "lunatic" },
        inPlayDemon: null,
      },
    });

    expect(state.players[0]?.role).toBe("imp");
    expect(state.players[0]?.alignmentIndex).toBe(0);
    expect(state.players[0]?.reminders[0]?.role).toBe("lunatic");
    expect(state.players[0]?.reminders[0]?.name).toMatch(/Lunatic/i);
  });

  it("adds Lil' Monsta as an extra token when in play", () => {
    const state = buildClocktowerLiveGamestate({
      config: { ...config, enabledRoleIds: [...config.enabledRoleIds, "lilmonsta"] },
      players: [{ id: "p1", displayName: "Ada", seat: 1, alive: true }],
      draft: {
        picks: { p1: "poisoner" },
        beliefs: {},
        secretAssignments: {},
        inPlayDemon: "lilmonsta",
      },
    });

    expect(state.players).toHaveLength(2);
    expect(state.players[1]?.name).toBe("Lil' Monsta");
    expect(state.players[1]?.role).toBe("lilmonsta");
  });

  it("serializes to compact JSON", () => {
    const json = serializeClocktowerLiveGamestate(
      buildClocktowerLiveGamestate({
        config,
        players: [],
        draft: null,
      }),
    );
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('"edition"');
  });
});

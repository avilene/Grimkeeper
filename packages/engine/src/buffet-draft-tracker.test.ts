import { describe, expect, it } from "vitest";
import {
  defaultBuffetConfig,
  formatBuffetDraftTracker,
  type BuffetDraftState,
} from "./buffet-draft.js";

function makeDraft(overrides: Partial<BuffetDraftState> = {}): BuffetDraftState {
  return {
    status: "active",
    config: defaultBuffetConfig(),
    pool: [],
    remainingSlots: { townsfolk: 1, outsider: 0, minion: 0, demon: 1 },
    draftOrder: ["p1", "p2"],
    currentIndex: 0,
    currentOffer: {
      playerId: "p1",
      roleIds: ["washerwoman"],
      mulliganStep: 1,
    },
    mulligansUsed: { p1: 1 },
    declinedRoles: { p1: ["empath", "librarian"] },
    picks: {},
    secretAssignments: {},
    beliefs: {},
    inPlayDemon: null,
    ...overrides,
  };
}

describe("formatBuffetDraftTracker", () => {
  it("highlights the current picker and lists declines", () => {
    const { title, description } = formatBuffetDraftTracker({
      players: [
        { id: "p1", displayName: "Ada", seat: 1 },
        { id: "p2", displayName: "Bram", seat: 2 },
      ],
      draft: makeDraft(),
    });

    expect(title).toMatch(/Draft tracker/i);
    expect(description).toMatch(/▶ \*\*Ada\*\* is picking/);
    expect(description).toMatch(/declined: Empath, Librarian/);
    expect(description).toMatch(/• seat 2 · \*\*Bram\*\* waiting/);
  });

  it("shows picks with optional declines", () => {
    const { description } = formatBuffetDraftTracker({
      players: [
        { id: "p1", displayName: "Ada", seat: 1 },
        { id: "p2", displayName: "Bram", seat: 2 },
      ],
      draft: makeDraft({
        currentIndex: 1,
        currentOffer: {
          playerId: "p2",
          roleIds: ["imp"],
          mulliganStep: 0,
        },
        picks: { p1: "washerwoman" },
        declinedRoles: { p1: ["empath"] },
      }),
    });

    expect(description).toMatch(/Ada.*Washerwoman.*declined: Empath/s);
    expect(description).toMatch(/▶.*Bram.*is picking/);
  });
});

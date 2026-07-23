import { describe, expect, it } from "vitest";

import {
  normalizeDoActionInput,
  resolveDoActionName,
  ST_DO_ACTIONS,
  ST_SLASH_SHORTCUTS,
} from "./action-catalog.js";

function filterDoActions(query: string) {
  const q = query.trim().toLowerCase();
  return ST_DO_ACTIONS.filter(
    (action) =>
      action.name.includes(q) || action.description.toLowerCase().includes(q),
  );
}

describe("normalizeDoActionInput", () => {
  it("strips autocomplete label after an em dash", () => {
    expect(
      normalizeDoActionInput("log — Create or reopen the ST-only audit log thread"),
    ).toBe("log");
  });

  it("keeps hyphenated action names", () => {
    expect(normalizeDoActionInput("mark-dead")).toBe("mark-dead");
    expect(normalizeDoActionInput("close-nominations — Close nominations")).toBe(
      "close-nominations",
    );
    expect(
      normalizeDoActionInput(
        "recreate-player-thread—Create or reopen one player's private ST thread",
      ),
    ).toBe("recreate-player-thread");
  });
});

describe("resolveDoActionName", () => {
  it("resolves pasted autocomplete labels to action names", () => {
    expect(
      resolveDoActionName(
        "log — Create or reopen the ST-only audit log thread",
        ST_DO_ACTIONS,
      ),
    ).toBe("log");
    expect(resolveDoActionName("LOG", ST_DO_ACTIONS)).toBe("log");
    expect(resolveDoActionName("recreate-player-thread", ST_DO_ACTIONS)).toBe(
      "recreate-player-thread",
    );
  });

  it("returns null for unknown actions", () => {
    expect(resolveDoActionName("nope — something", ST_DO_ACTIONS)).toBeNull();
  });
});

describe("ST_SLASH_SHORTCUTS", () => {
  it("only elevates actions that exist in /st do", () => {
    const doNames = new Set(ST_DO_ACTIONS.map((action) => action.name));
    for (const shortcut of ST_SLASH_SHORTCUTS) {
      expect(doNames.has(shortcut.name)).toBe(true);
    }
  });

  it("keeps a focused mobile set (not the full catalog)", () => {
    expect(ST_SLASH_SHORTCUTS.length).toBeGreaterThanOrEqual(6);
    expect(ST_SLASH_SHORTCUTS.length).toBeLessThan(ST_DO_ACTIONS.length);
    expect(ST_SLASH_SHORTCUTS.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "setup-town",
        "say",
        "log",
        "end",
        "next-phase",
        "reset-to-setup",
        "recreate-player-thread",
        "close-nominations",
        "resolve-next",
        "execute",
        "mark-dead",
      ]),
    );
  });
});

describe("reset-to-setup discoverability", () => {
  it("is in the /st do catalog and mobile shortcuts", () => {
    expect(ST_DO_ACTIONS.some((a) => a.name === "reset-to-setup")).toBe(true);
    expect(ST_SLASH_SHORTCUTS.some((a) => a.name === "reset-to-setup")).toBe(true);
  });

  it("matches typing reset in /st do autocomplete filters", () => {
    const names = filterDoActions("reset").map((a) => a.name);
    expect(names).toContain("reset-to-setup");
  });
});

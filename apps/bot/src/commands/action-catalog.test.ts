import { describe, expect, it } from "vitest";

import {
  normalizeDoActionInput,
  resolveDoActionName,
  PLAYER_DAY_ACTIONS,
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
    // Discord: /st top-level ≤ 25 (shortcuts + do/mark/panel/add-kib/remove-kib + help/guide/reminder/queue).
    expect(ST_SLASH_SHORTCUTS.length + 5 + 4).toBeLessThanOrEqual(25);
    expect(ST_SLASH_SHORTCUTS.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "setup-town",
        "broadcast",
        "log",
        "end",
        "next-phase",
        "recreate-player-thread",
        "close-nominations",
        "nominate",
        "refresh-noms",
        "resolve-next",
        "extend-noms",
        "ping-missing",
        "sub",
        "execute",
        "mark-dead",
      ]),
    );
    // Stay on /st do only so /st stays under Discord's 25-option cap.
    const shortcutNames = ST_SLASH_SHORTCUTS.map((a) => a.name);
    expect(shortcutNames).not.toContain("fail-open-noms");
    expect(shortcutNames).not.toContain("repost-kib-noms");
    expect(shortcutNames).not.toContain("reset-to-setup");
  });
});

describe("reset-to-setup discoverability", () => {
  it("is in the /st do catalog but not a first-class shortcut", () => {
    expect(ST_DO_ACTIONS.some((a) => a.name === "reset-to-setup")).toBe(true);
    expect(ST_SLASH_SHORTCUTS.some((a) => a.name === "reset-to-setup")).toBe(false);
  });

  it("matches typing reset in /st do autocomplete filters", () => {
    const names = filterDoActions("reset").map((a) => a.name);
    expect(names).toContain("reset-to-setup");
  });
});

describe("sub discoverability", () => {
  it("is in /st do and mobile shortcuts", () => {
    expect(ST_DO_ACTIONS.some((a) => a.name === "sub")).toBe(true);
    expect(ST_SLASH_SHORTCUTS.some((a) => a.name === "sub")).toBe(true);
  });
});

describe("backpacker discoverability", () => {
  it("is a top-level /backpack command, not /st do", () => {
    expect(ST_DO_ACTIONS.some((a) => a.name === "add-backpacker")).toBe(false);
    expect(ST_DO_ACTIONS.some((a) => a.name === "remove-backpacker")).toBe(false);
    expect(ST_SLASH_SHORTCUTS.some((a) => a.name === "add-backpacker")).toBe(false);
    expect(PLAYER_DAY_ACTIONS.some((a) => a.name === "backpack add")).toBe(true);
    expect(PLAYER_DAY_ACTIONS.some((a) => a.name === "backpack remove")).toBe(true);
  });
});

describe("sync-player-roles discoverability", () => {
  it("is in /st do but not a first-class shortcut", () => {
    expect(ST_DO_ACTIONS.some((a) => a.name === "sync-player-roles")).toBe(true);
    expect(ST_SLASH_SHORTCUTS.some((a) => a.name === "sync-player-roles")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  canActAsStoryteller,
  interactionMemberHasRole,
  memberHasGameStRole,
} from "./command-context.js";

describe("interactionMemberHasRole", () => {
  it("reads role ids from APIInteractionGuildMember (string[] roles)", () => {
    const interaction = {
      member: { roles: ["st-role", "other"] },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBe(true);
    expect(interactionMemberHasRole(interaction as never, "missing")).toBe(false);
  });

  it("reads roles from GuildMember RoleManager cache (hit only; miss is unknown)", () => {
    const interaction = {
      member: {
        roles: { cache: { has: (id: string) => id === "st-role" } },
      },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBe(true);
    expect(interactionMemberHasRole(interaction as never, "missing")).toBeNull();
  });

  it("treats GuildMember role-cache miss as unknown (incomplete without Guild Members intent)", () => {
    const interaction = {
      member: {
        roles: { cache: { has: () => false } },
      },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBeNull();
  });

  it("returns null when member is missing", () => {
    expect(interactionMemberHasRole({ member: null } as never, "st-role")).toBeNull();
  });
});

describe("memberHasGameStRole", () => {
  it("accepts ST role from interaction payload without fetching members", async () => {
    const fetch = vi.fn();
    const interaction = {
      guild: { members: { fetch, cache: { get: () => undefined } } },
      member: { roles: ["game-st"] },
      user: { id: "u1" },
    };

    await expect(
      memberHasGameStRole(interaction as never, {
        channelId: "town",
        stRoleId: "game-st",
      }),
    ).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("denies when payload roles omit the ST role (no fetch)", async () => {
    const fetch = vi.fn();
    const interaction = {
      guild: { members: { fetch, cache: { get: () => undefined } } },
      member: { roles: ["player-role"] },
      user: { id: "u1" },
    };

    await expect(
      memberHasGameStRole(interaction as never, {
        channelId: "town",
        stRoleId: "game-st",
      }),
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("REST-fetches when GuildMember cache misses the ST role", async () => {
    const fetch = vi.fn(async () => ({
      roles: { cache: { has: (id: string) => id === "game-st" } },
    }));
    const interaction = {
      guild: {
        members: {
          fetch,
          cache: { get: () => undefined },
        },
      },
      member: {
        roles: { cache: { has: () => false } },
      },
      user: { id: "u1" },
    };

    await expect(
      memberHasGameStRole(interaction as never, {
        channelId: "town",
        stRoleId: "game-st",
      }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });

  it("force-fetches past a cached GuildMember with incomplete roles", async () => {
    const stale = {
      id: "u1",
      partial: false,
      roles: { cache: { has: () => false } },
    };
    const fetch = vi.fn(async () => ({
      roles: { cache: { has: (id: string) => id === "game-st" } },
    }));
    const interaction = {
      guild: {
        members: {
          fetch,
          cache: { get: () => stale },
        },
      },
      member: {
        roles: { cache: { has: () => false } },
      },
      user: { id: "u1" },
    };

    await expect(
      memberHasGameStRole(interaction as never, {
        channelId: "town",
        stRoleId: "game-st",
      }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });

  it("falls back to timed member fetch when interaction has no member", async () => {
    const fetch = vi.fn(async () => ({
      roles: { cache: { has: (id: string) => id === "game-st" } },
    }));
    const interaction = {
      guild: {
        members: {
          fetch,
          cache: { get: () => undefined },
        },
      },
      member: null,
      user: { id: "u1" },
    };

    await expect(
      memberHasGameStRole(interaction as never, {
        channelId: "town",
        stRoleId: "game-st",
      }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });
});

describe("canActAsStoryteller", () => {
  it("accepts game ST role holders even when they are not engine STs", async () => {
    const interaction = {
      user: { id: "u2" },
      guild: { id: "g1" },
      member: { roles: ["game-st"] },
    };
    await expect(
      canActAsStoryteller(interaction as never, { channelId: "town", stRoleId: "game-st" }, {
        isStoryteller: () => false,
      }),
    ).resolves.toBe(true);
  });

  it("still accepts engine storytellers without the Discord role", async () => {
    const interaction = {
      user: { id: "u1" },
      guild: null,
      member: null,
    };
    await expect(
      canActAsStoryteller(interaction as never, { channelId: "town", stRoleId: "st" }, {
        isStoryteller: (id) => id === "u1",
      }),
    ).resolves.toBe(true);
  });

  it("rejects users with neither engine ST nor game ST role", async () => {
    const interaction = {
      user: { id: "u3" },
      guild: { id: "g1" },
      member: { roles: ["player"] },
    };
    await expect(
      canActAsStoryteller(interaction as never, { channelId: "town", stRoleId: "game-st" }, {
        isStoryteller: () => false,
      }),
    ).resolves.toBe(false);
  });
});

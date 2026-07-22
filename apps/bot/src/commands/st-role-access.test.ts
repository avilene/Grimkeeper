import { describe, expect, it, vi } from "vitest";

import { interactionMemberHasRole, memberHasGameStRole } from "./command-context.js";

describe("interactionMemberHasRole", () => {
  it("reads role ids from APIInteractionGuildMember (string[] roles)", () => {
    const interaction = {
      member: { roles: ["st-role", "other"] },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBe(true);
    expect(interactionMemberHasRole(interaction as never, "missing")).toBe(false);
  });

  it("reads roles from GuildMember RoleManager cache", () => {
    const interaction = {
      member: {
        roles: { cache: { has: (id: string) => id === "st-role" } },
      },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBe(true);
    expect(interactionMemberHasRole(interaction as never, "missing")).toBe(false);
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
    expect(fetch).toHaveBeenCalledWith("u1");
  });
});

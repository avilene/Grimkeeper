import { describe, expect, it, vi } from "vitest";

import { fetchGuildMemberWithTimeout, MEMBER_FETCH_TIMEOUT_MS } from "../access.js";
import {
  addRoleMembersToThread,
  addRoleToUser,
  removeRoleFromUser,
  resolveGameRoles,
  transferGamePlayerRole,
} from "./command-context.js";

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(async () => undefined),
}));

import { reportError } from "../error-reporter.js";

describe("addRoleToUser / removeRoleFromUser", () => {
  it("uses REST addRole/removeRole and never guild.members.fetch", async () => {
    const addRole = vi.fn(async () => "user");
    const removeRole = vi.fn(async () => "user");
    const fetch = vi.fn();
    const guild = {
      id: "g1",
      members: { addRole, removeRole, fetch },
    };

    await expect(addRoleToUser(guild as never, "111", "role-kib")).resolves.toBe(true);
    await expect(removeRoleFromUser(guild as never, "111", "role-kib")).resolves.toBe(true);

    expect(addRole).toHaveBeenCalledWith({ user: "111", role: "role-kib" });
    expect(removeRole).toHaveBeenCalledWith({ user: "111", role: "role-kib" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns false when Discord rejects the role assign", async () => {
    const guild = {
      id: "g1",
      members: {
        addRole: vi.fn(async () => {
          throw new Error("Missing Permissions");
        }),
        removeRole: vi.fn(async () => {
          throw new Error("Unknown Role");
        }),
      },
    };

    await expect(addRoleToUser(guild as never, "111", "role-p")).resolves.toBe(false);
    await expect(removeRoleFromUser(guild as never, "111", "role-p")).resolves.toBe(false);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(
      "discord.role.add.failed",
      expect.any(Error),
      expect.objectContaining({ guildId: "g1", userId: "111", roleId: "role-p" }),
    );
  });
});

describe("resolveGameRoles", () => {
  it("falls through to name lookup when stored role ids are stale", async () => {
    const stRole = { id: "st-live", name: "st-town" };
    const playersRole = { id: "p-live", name: "p-town" };
    const spectatorRole = { id: "spec-live", name: "spec-town" };
    const roleCache = new Map<string, { id: string; name: string }>([
      [stRole.id, stRole],
      [playersRole.id, playersRole],
      [spectatorRole.id, spectatorRole],
    ]);
    const guild = {
      roles: {
        fetch: vi.fn(async () => undefined),
        cache: {
          get: (id: string) => roleCache.get(id),
          find: (fn: (role: { id: string; name: string }) => boolean) =>
            [...roleCache.values()].find(fn),
        },
      },
      channels: {
        fetch: vi.fn(async () => ({ name: "Town" })),
      },
    };

    const roles = await resolveGameRoles(guild as never, {
      channelId: "ch1",
      stRoleId: "st-stale",
      playerRoleId: "p-stale",
      kibRoleId: "kib-stale",
    });

    expect(roles?.playersRole.id).toBe("p-live");
    expect(roles?.stRole.id).toBe("st-live");
    expect(roles?.spectatorRole.id).toBe("spec-live");
  });
});

describe("transferGamePlayerRole", () => {
  it("adds the player role to the new user before removing from the old", async () => {
    const order: string[] = [];
    const addRole = vi.fn(async ({ user }: { user: string }) => {
      order.push(`add:${user}`);
      return "user";
    });
    const removeRole = vi.fn(async ({ user }: { user: string }) => {
      order.push(`remove:${user}`);
      return "user";
    });
    const playerRole = { id: "role-p", name: "p-town" };
    const guild = {
      id: "g1",
      members: { addRole, removeRole },
      roles: {
        fetch: vi.fn(async (id?: string) => {
          if (id === "role-p") return playerRole;
          return undefined;
        }),
        cache: {
          get: (id: string) => (id === "role-p" ? playerRole : undefined),
          find: () => undefined,
        },
      },
      channels: { fetch: vi.fn(async () => null) },
    };

    const result = await transferGamePlayerRole(
      guild as never,
      { channelId: "ch1", playerRoleId: "role-p", stRoleId: "st", kibRoleId: "kib" },
      "old-user",
      "new-user",
    );

    expect(result).toEqual({ status: "transferred", roleId: "role-p" });
    expect(order).toEqual(["add:new-user", "remove:old-user"]);
  });

  it("reports failed when Discord rejects adding the player role", async () => {
    const playerRole = { id: "role-p", name: "p-town" };
    const removeRole = vi.fn(async () => "user");
    const guild = {
      id: "g1",
      members: {
        addRole: vi.fn(async () => {
          throw new Error("Missing Permissions");
        }),
        removeRole,
      },
      roles: {
        fetch: vi.fn(async () => playerRole),
        cache: {
          get: (id: string) => (id === "role-p" ? playerRole : undefined),
          find: () => undefined,
        },
      },
      channels: { fetch: vi.fn(async () => null) },
    };

    const result = await transferGamePlayerRole(
      guild as never,
      { channelId: "ch1", playerRoleId: "role-p" },
      "old-user",
      "new-user",
    );

    expect(result).toEqual({
      status: "failed",
      roleId: "role-p",
      added: false,
      removed: false,
    });
    expect(removeRole).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      "discord.role.add.failed",
      expect.any(Error),
      expect.objectContaining({
        guildId: "g1",
        userId: "new-user",
        roleId: "role-p",
        operation: "transferGamePlayerRole",
      }),
    );
  });
});

describe("addRoleMembersToThread", () => {
  it("adds cached role members without bulk guild.members.fetch", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("bulk fetch should not run");
    });
    const threadAdd = vi.fn(async () => "ok");
    const guild = {
      members: {
        fetch,
        cache: new Map([
          [
            "with-role",
            {
              id: "with-role",
              roles: { cache: { has: (id: string) => id === "kib-role" } },
            },
          ],
          [
            "without-role",
            {
              id: "without-role",
              roles: { cache: { has: () => false } },
            },
          ],
        ]),
      },
    };
    // Map.values() works; discord Collection is Map-like for our iteration.
    const thread = { members: { add: threadAdd } };

    await addRoleMembersToThread(guild as never, thread as never, "kib-role");

    expect(fetch).not.toHaveBeenCalled();
    expect(threadAdd).toHaveBeenCalledTimes(1);
    expect(threadAdd).toHaveBeenCalledWith("with-role");
  });

  it("returns how many cached role members were invited", async () => {
    const threadAdd = vi.fn(async () => "ok");
    const guild = {
      members: {
        fetch: vi.fn(),
        cache: new Map([
          ["a", { id: "a", roles: { cache: { has: (id: string) => id === "st-role" } } }],
          ["b", { id: "b", roles: { cache: { has: (id: string) => id === "st-role" } } }],
          ["c", { id: "c", roles: { cache: { has: () => false } } }],
        ]),
      },
    };
    const thread = { members: { add: threadAdd } };

    const added = await addRoleMembersToThread(guild as never, thread as never, "st-role");
    expect(added).toBe(2);
  });
});

describe("fetchGuildMemberWithTimeout", () => {
  it("returns cached non-partial members without fetching", async () => {
    const cached = { id: "u1", partial: false, displayName: "A" };
    const fetch = vi.fn();
    const guild = {
      members: {
        cache: { get: (id: string) => (id === "u1" ? cached : undefined) },
        fetch,
      },
    };

    const member = await fetchGuildMemberWithTimeout(guild as never, "u1");
    expect(member).toBe(cached);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("force-fetches even when a non-partial member is cached", async () => {
    const cached = { id: "u1", partial: false, displayName: "A" };
    const fresh = { id: "u1", partial: false, displayName: "B" };
    const fetch = vi.fn(async () => fresh);
    const guild = {
      members: {
        cache: { get: (id: string) => (id === "u1" ? cached : undefined) },
        fetch,
      },
    };

    const member = await fetchGuildMemberWithTimeout(guild as never, "u1", 2_000, { force: true });
    expect(member).toBe(fresh);
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });

  it("times out hung member fetches", async () => {
    const guild = {
      members: {
        cache: { get: () => undefined },
        fetch: vi.fn(() => new Promise(() => undefined)),
      },
    };

    const started = Date.now();
    const member = await fetchGuildMemberWithTimeout(guild as never, "u1", 50);
    expect(member).toBeNull();
    expect(Date.now() - started).toBeLessThan(MEMBER_FETCH_TIMEOUT_MS);
  });
});

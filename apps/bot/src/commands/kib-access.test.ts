import { describe, expect, it, vi } from "vitest";

import { fetchGuildMemberWithTimeout, MEMBER_FETCH_TIMEOUT_MS } from "../access.js";
import { addRoleMembersToThread, addRoleToUser, removeRoleFromUser } from "./command-context.js";

describe("addRoleToUser / removeRoleFromUser", () => {
  it("uses REST addRole/removeRole and never guild.members.fetch", async () => {
    const addRole = vi.fn(async () => "user");
    const removeRole = vi.fn(async () => "user");
    const fetch = vi.fn();
    const guild = {
      members: { addRole, removeRole, fetch },
    };

    await addRoleToUser(guild as never, "111", "role-kib");
    await removeRoleFromUser(guild as never, "111", "role-kib");

    expect(addRole).toHaveBeenCalledWith({ user: "111", role: "role-kib" });
    expect(removeRole).toHaveBeenCalledWith({ user: "111", role: "role-kib" });
    expect(fetch).not.toHaveBeenCalled();
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

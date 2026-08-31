import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canUseBot,
  interactionMemberHasAnyRole,
  interactionMemberHasRole,
  isInExplicitAllowlist,
  memberHasAnyRole,
  type AccessInteraction,
} from "./access.js";

const originalAdminIds = process.env.ADMIN_IDS;
const originalAllowedRoleIds = process.env.ALLOWED_ROLE_IDS;

afterEach(() => {
  if (originalAdminIds === undefined) delete process.env.ADMIN_IDS;
  else process.env.ADMIN_IDS = originalAdminIds;
  if (originalAllowedRoleIds === undefined) delete process.env.ALLOWED_ROLE_IDS;
  else process.env.ALLOWED_ROLE_IDS = originalAllowedRoleIds;
});

describe("interactionMemberHasRole", () => {
  it("reads role ids from APIInteractionGuildMember (string[] roles)", () => {
    const interaction = { member: { roles: ["st-role", "other"] } };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBe(true);
    expect(interactionMemberHasRole(interaction as never, "missing")).toBe(false);
  });

  it("treats GuildMember role-cache miss as unknown", () => {
    const interaction = {
      member: { roles: { cache: { has: () => false } } },
    };
    expect(interactionMemberHasRole(interaction as never, "st-role")).toBeNull();
  });
});

describe("interactionMemberHasAnyRole", () => {
  it("returns true when any listed role is present on the payload", () => {
    expect(
      interactionMemberHasAnyRole({ member: { roles: ["a", "st-town"] } } as never, [
        "st-town",
        "st-other",
      ]),
    ).toBe(true);
  });

  it("returns false when the payload is complete and has none of the roles", () => {
    expect(
      interactionMemberHasAnyRole({ member: { roles: ["player"] } } as never, ["st-town"]),
    ).toBe(false);
  });
});

describe("memberHasAnyRole", () => {
  it("accepts a role from the interaction payload without fetching members", async () => {
    const fetch = vi.fn();
    const interaction = {
      guild: { members: { fetch, cache: { get: () => undefined } } },
      member: { roles: ["town-st"] },
      user: { id: "u1" },
    };

    await expect(memberHasAnyRole(interaction as never, ["town-st"])).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("force-fetches when GuildMember cache misses", async () => {
    const fetch = vi.fn(async () => ({
      roles: { cache: { has: (id: string) => id === "town-st" } },
    }));
    const interaction = {
      guild: {
        members: { fetch, cache: { get: () => undefined } },
      },
      member: { roles: { cache: { has: () => false } } },
      user: { id: "u1" },
    };

    await expect(memberHasAnyRole(interaction as never, ["town-st"])).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });
});

describe("canUseBot", () => {
  it("allows everyone when no allowlist is configured", async () => {
    delete process.env.ADMIN_IDS;
    delete process.env.ALLOWED_ROLE_IDS;
    await expect(
      canUseBot({ user: { id: "anyone" }, guildId: "g1", member: { roles: [] } } as never),
    ).resolves.toBe(true);
  });

  it("allows ADMIN_IDS users", async () => {
    process.env.ADMIN_IDS = "admin1,admin2";
    process.env.ALLOWED_ROLE_IDS = "role-a";
    await expect(canUseBot({ user: { id: "admin2" }, guildId: "g1" } as never)).resolves.toBe(true);
    await expect(
      canUseBot({
        user: { id: "other" },
        guildId: "g1",
        member: { roles: [] } as unknown as AccessInteraction["member"],
      }),
    ).resolves.toBe(false);
  });

  it("allows ALLOWED_ROLE_IDS from the interaction payload without a member fetch", async () => {
    process.env.ADMIN_IDS = "admin-1";
    process.env.ALLOWED_ROLE_IDS = "town-st,other-st";
    const fetch = vi.fn();
    const interaction = {
      user: { id: "st-user" },
      guildId: "g1",
      guild: { members: { fetch, cache: { get: () => undefined } } },
      member: { roles: ["town-st"] },
    };

    await expect(canUseBot(interaction as never)).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads GuildMember role cache when present", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-st";
    const cache = new Map([["role-st", { id: "role-st" }]]);
    await expect(
      canUseBot({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: { cache } } as unknown as AccessInteraction["member"],
      }),
    ).resolves.toBe(true);
  });

  it("denies users who are on neither ADMIN_IDS nor ALLOWED_ROLE_IDS", async () => {
    process.env.ADMIN_IDS = "admin-1";
    process.env.ALLOWED_ROLE_IDS = "allowed-role";
    await expect(
      canUseBot({
        user: { id: "st-user" },
        guildId: "g1",
        guild: { members: { fetch: vi.fn(), cache: { get: () => undefined } } },
        member: { roles: ["town-st"] },
      } as never),
    ).resolves.toBe(false);
  });
});

describe("isInExplicitAllowlist", () => {
  it("is false when no allowlist is configured", async () => {
    delete process.env.ADMIN_IDS;
    delete process.env.ALLOWED_ROLE_IDS;
    await expect(
      isInExplicitAllowlist({ user: { id: "anyone" }, guildId: "g1" } as never),
    ).resolves.toBe(false);
  });

  it("matches payload roles", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-a";
    await expect(
      isInExplicitAllowlist({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: ["role-a"] } as unknown as AccessInteraction["member"],
      }),
    ).resolves.toBe(true);
  });
});

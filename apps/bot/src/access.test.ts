import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@grimkeeper/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grimkeeper/database")>();
  return {
    ...actual,
    getGuildSettings: vi.fn(),
  };
});

import { getGuildSettings } from "@grimkeeper/database";
import {
  canConfigureGuild,
  canUseBot,
  interactionMemberHasAnyRole,
  interactionMemberHasRole,
  isInExplicitAllowlist,
  memberHasAnyRole,
  resolveGuildAccessConfig,
  type AccessInteraction,
} from "./access.js";

const originalAdminIds = process.env.ADMIN_IDS;
const originalAllowedRoleIds = process.env.ALLOWED_ROLE_IDS;
const originalAdminRoleIds = process.env.ADMIN_ROLE_IDS;

afterEach(() => {
  if (originalAdminIds === undefined) delete process.env.ADMIN_IDS;
  else process.env.ADMIN_IDS = originalAdminIds;
  if (originalAllowedRoleIds === undefined) delete process.env.ALLOWED_ROLE_IDS;
  else process.env.ALLOWED_ROLE_IDS = originalAllowedRoleIds;
  if (originalAdminRoleIds === undefined) delete process.env.ADMIN_ROLE_IDS;
  else process.env.ADMIN_ROLE_IDS = originalAdminRoleIds;
  vi.mocked(getGuildSettings).mockReset();
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

describe("resolveGuildAccessConfig", () => {
  it("uses env when no guild settings row", async () => {
    process.env.ALLOWED_ROLE_IDS = "env-role";
    process.env.ADMIN_ROLE_IDS = "env-admin";
    vi.mocked(getGuildSettings).mockResolvedValue(null);

    const config = await resolveGuildAccessConfig("g1");
    expect([...config.allowedRoleIds]).toEqual(["env-role"]);
    expect([...config.adminRoleIds]).toEqual(["env-admin"]);
    expect(config.allowedRolesFromDb).toBe(false);
  });

  it("prefers guild DB allowed roles over env", async () => {
    process.env.ALLOWED_ROLE_IDS = "env-role";
    vi.mocked(getGuildSettings).mockResolvedValue({
      guildId: "g1",
      allowedRoleIds: "guild-role",
      adminRoleIds: null,
      reminderRoleIds: null,
      reminderPingRoleId: null,
      archiveCategoryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const config = await resolveGuildAccessConfig("g1");
    expect([...config.allowedRoleIds]).toEqual(["guild-role"]);
    expect(config.allowedRolesFromDb).toBe(true);
  });

  it("treats empty DB allowedRoleIds as open for this guild", async () => {
    process.env.ALLOWED_ROLE_IDS = "env-role";
    vi.mocked(getGuildSettings).mockResolvedValue({
      guildId: "g1",
      allowedRoleIds: "",
      adminRoleIds: null,
      reminderRoleIds: null,
      reminderPingRoleId: null,
      archiveCategoryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const config = await resolveGuildAccessConfig("g1");
    expect(config.allowedRoleIds.size).toBe(0);
    expect(config.allowedRolesFromDb).toBe(true);
  });
});

describe("canUseBot", () => {
  it("allows everyone when no allowlist is configured", async () => {
    delete process.env.ADMIN_IDS;
    delete process.env.ALLOWED_ROLE_IDS;
    vi.mocked(getGuildSettings).mockResolvedValue(null);
    await expect(
      canUseBot({ user: { id: "anyone" }, guildId: "g1", member: { roles: [] } } as never),
    ).resolves.toBe(true);
  });

  it("allows ADMIN_IDS users", async () => {
    process.env.ADMIN_IDS = "admin1,admin2";
    process.env.ALLOWED_ROLE_IDS = "role-a";
    vi.mocked(getGuildSettings).mockResolvedValue(null);
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
    vi.mocked(getGuildSettings).mockResolvedValue(null);
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

  it("uses per-guild allowed roles instead of env", async () => {
    process.env.ALLOWED_ROLE_IDS = "env-only";
    vi.mocked(getGuildSettings).mockResolvedValue({
      guildId: "g2",
      allowedRoleIds: "guild-st",
      adminRoleIds: null,
      reminderRoleIds: null,
      reminderPingRoleId: null,
      archiveCategoryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      canUseBot({
        user: { id: "u1" },
        guildId: "g2",
        member: { roles: ["guild-st"] },
      } as never),
    ).resolves.toBe(true);
    await expect(
      canUseBot({
        user: { id: "u1" },
        guildId: "g2",
        member: { roles: ["env-only"] },
      } as never),
    ).resolves.toBe(false);
  });

  it("reads GuildMember role cache when present", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-st";
    vi.mocked(getGuildSettings).mockResolvedValue(null);
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
    vi.mocked(getGuildSettings).mockResolvedValue(null);
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
    vi.mocked(getGuildSettings).mockResolvedValue(null);
    await expect(
      isInExplicitAllowlist({ user: { id: "anyone" }, guildId: "g1" } as never),
    ).resolves.toBe(false);
  });

  it("matches payload roles", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-a";
    vi.mocked(getGuildSettings).mockResolvedValue(null);
    await expect(
      isInExplicitAllowlist({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: ["role-a"] } as unknown as AccessInteraction["member"],
      }),
    ).resolves.toBe(true);
  });
});

describe("canConfigureGuild", () => {
  it("allows ADMIN_IDS", async () => {
    process.env.ADMIN_IDS = "ops-1";
    vi.mocked(getGuildSettings).mockResolvedValue(null);
    await expect(
      canConfigureGuild({ user: { id: "ops-1" }, guildId: "g1" } as never),
    ).resolves.toBe(true);
  });

  it("allows Manage Server", async () => {
    delete process.env.ADMIN_IDS;
    vi.mocked(getGuildSettings).mockResolvedValue(null);
    await expect(
      canConfigureGuild({
        user: { id: "mod-1" },
        guildId: "g1",
        memberPermissions: { has: (bit: bigint) => bit === 0x20n },
      } as never),
    ).resolves.toBe(true);
  });
});

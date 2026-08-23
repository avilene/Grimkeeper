import { afterEach, describe, expect, it } from "vitest";

import { canUseBot, isInExplicitAllowlist, type AccessInteraction } from "./access.js";

describe("canUseBot", () => {
  afterEach(() => {
    delete process.env.ADMIN_IDS;
    delete process.env.ALLOWED_ROLE_IDS;
  });

  it("allows everyone when no allowlist is configured", async () => {
    expect(await canUseBot({ user: { id: "u1" }, guildId: "g1" })).toBe(true);
  });

  it("allows ADMIN_IDS users", async () => {
    process.env.ADMIN_IDS = "admin1,admin2";
    process.env.ALLOWED_ROLE_IDS = "role-a";
    expect(await canUseBot({ user: { id: "admin2" }, guildId: "g1" })).toBe(true);
    expect(
      await canUseBot({
        user: { id: "other" },
        guildId: "g1",
        member: { roles: [] } as unknown as AccessInteraction["member"],
      }),
    ).toBe(false);
  });

  it("uses interaction payload role ids without fetching members", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-st,role-helper";
    expect(
      await canUseBot({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: ["role-other", "role-st"] } as unknown as AccessInteraction["member"],
      }),
    ).toBe(true);
    expect(
      await canUseBot({
        user: { id: "u2" },
        guildId: "g1",
        member: { roles: ["role-other"] } as unknown as AccessInteraction["member"],
      }),
    ).toBe(false);
  });

  it("reads GuildMember role cache when present", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-st";
    const cache = new Map([["role-st", { id: "role-st" }]]);
    expect(
      await canUseBot({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: { cache } } as unknown as AccessInteraction["member"],
      }),
    ).toBe(true);
  });
});

describe("isInExplicitAllowlist", () => {
  afterEach(() => {
    delete process.env.ADMIN_IDS;
    delete process.env.ALLOWED_ROLE_IDS;
  });

  it("is false when no allowlist is configured", async () => {
    expect(await isInExplicitAllowlist({ user: { id: "u1" }, guildId: "g1" })).toBe(false);
  });

  it("matches payload roles", async () => {
    process.env.ALLOWED_ROLE_IDS = "role-a";
    expect(
      await isInExplicitAllowlist({
        user: { id: "u1" },
        guildId: "g1",
        member: { roles: ["role-a"] } as unknown as AccessInteraction["member"],
      }),
    ).toBe(true);
  });
});

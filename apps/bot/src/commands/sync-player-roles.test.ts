import { describe, expect, it, vi } from "vitest";

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(async () => undefined),
}));

vi.mock("../access.js", () => ({
  fetchGuildMemberWithTimeout: vi.fn(),
  MEMBER_FETCH_TIMEOUT_MS: 2_000,
}));

import { fetchGuildMemberWithTimeout } from "../access.js";
import { syncGamePlayerRoles } from "./command-context.js";

describe("syncGamePlayerRoles", () => {
  const playerRole = { id: "role-p", name: "p-town" };
  const guild = {
    id: "g1",
    members: {
      addRole: vi.fn(async () => "user"),
      removeRole: vi.fn(async () => "user"),
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

  const engine = {
    getState: () => ({
      players: [
        {
          id: "p1",
          discordUserId: "u-has",
          displayName: "Has",
          isFake: false,
          seat: 1,
        },
        {
          id: "p2",
          discordUserId: "u-needs",
          displayName: "Needs",
          isFake: false,
          seat: 2,
        },
        {
          id: "p3",
          discordUserId: "dev:fake",
          displayName: "Dev",
          isFake: true,
          seat: 3,
        },
        {
          id: "p4",
          discordUserId: "u-gone",
          displayName: "Gone",
          isFake: false,
          seat: 4,
        },
      ],
    }),
  };

  it("adds the player role only to seated users who are missing it", async () => {
    vi.mocked(fetchGuildMemberWithTimeout).mockImplementation(async (_guild, userId) => {
      if (userId === "u-has") {
        return { roles: { cache: { has: (id: string) => id === "role-p" } } } as never;
      }
      if (userId === "u-needs") {
        return { roles: { cache: { has: () => false } } } as never;
      }
      return null;
    });

    const result = await syncGamePlayerRoles(
      guild as never,
      { channelId: "ch1", playerRoleId: "role-p" },
      engine as never,
    );

    expect(result).toMatchObject({
      roleId: "role-p",
      seated: 3,
      alreadyHad: 1,
      addedUserIds: ["u-needs"],
      failedUserIds: [],
      notInGuildUserIds: ["u-gone"],
      skippedFake: 1,
    });
    expect(guild.members.addRole).toHaveBeenCalledWith({ user: "u-needs", role: "role-p" });
    expect(guild.members.addRole).not.toHaveBeenCalledWith({ user: "u-has", role: "role-p" });
  });
});

import { MessageFlags } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listActiveGamesForGuild, listEngineStorytellerGameIds } = vi.hoisted(() => ({
  listActiveGamesForGuild: vi.fn(async () => [] as Array<{ id: string; stRoleId: string | null }>),
  listEngineStorytellerGameIds: vi.fn(async () => [] as string[]),
}));

vi.mock("@grimkeeper/database", () => ({
  appendGameEvent: vi.fn(),
  getActiveGameForChannel: vi.fn(),
  getActiveGameForVenue: vi.fn(),
  getGameForChannelIncludingEnded: vi.fn(),
  getGameEvents: vi.fn(),
  listActiveGamesForGuild,
  listEngineStorytellerGameIds,
  listGameWhispers: vi.fn(),
  prisma: {},
  resolveArchiveCategoryId: vi.fn(),
  syncGameProjectionFromEngine: vi.fn(),
}));

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(async () => undefined),
}));

import { isActiveGameStoryteller, requireCommandAccess } from "./command-context.js";

const originalAdminIds = process.env.ADMIN_IDS;
const originalAllowedRoleIds = process.env.ALLOWED_ROLE_IDS;

function restrictedAllowlist() {
  process.env.ADMIN_IDS = "admin-1";
  process.env.ALLOWED_ROLE_IDS = "global-allowed";
}

afterEach(() => {
  if (originalAdminIds === undefined) delete process.env.ADMIN_IDS;
  else process.env.ADMIN_IDS = originalAdminIds;
  if (originalAllowedRoleIds === undefined) delete process.env.ALLOWED_ROLE_IDS;
  else process.env.ALLOWED_ROLE_IDS = originalAllowedRoleIds;
});

beforeEach(() => {
  listActiveGamesForGuild.mockReset();
  listEngineStorytellerGameIds.mockReset();
  listActiveGamesForGuild.mockResolvedValue([]);
  listEngineStorytellerGameIds.mockResolvedValue([]);
});

function interaction(overrides: Record<string, unknown> = {}) {
  return {
    guildId: "g1",
    channelId: "town",
    user: { id: "st-user" },
    member: { roles: ["town-st"] },
    guild: { id: "g1", members: { fetch: vi.fn(), cache: { get: () => undefined } } },
    deferred: false,
    replied: false,
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("requireCommandAccess", () => {
  it("allows holders of the ST role passed to /game setup even when they are not on the global allowlist", async () => {
    restrictedAllowlist();
    const ix = interaction();
    await expect(requireCommandAccess(ix as never, { extraRoleIds: ["town-st"] })).resolves.toBe(
      true,
    );
    expect(ix.reply).not.toHaveBeenCalled();
  });

  it("allows ST-role holders of an active game in this guild", async () => {
    restrictedAllowlist();
    listActiveGamesForGuild.mockResolvedValue([{ id: "game-1", stRoleId: "town-st" }]);
    const ix = interaction();
    await expect(requireCommandAccess(ix as never)).resolves.toBe(true);
    expect(ix.reply).not.toHaveBeenCalled();
  });

  it("denies users with neither allowlist nor ST access", async () => {
    restrictedAllowlist();
    const ix = interaction({ member: { roles: ["player"] } });
    await expect(requireCommandAccess(ix as never, { extraRoleIds: ["town-st"] })).resolves.toBe(
      false,
    );
    expect(ix.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("ADMIN_IDS"),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe("isActiveGameStoryteller", () => {
  it("matches the game ST role from the interaction payload", async () => {
    listActiveGamesForGuild.mockResolvedValue([{ id: "game-1", stRoleId: "town-st" }]);
    await expect(isActiveGameStoryteller(interaction() as never)).resolves.toBe(true);
    expect(listEngineStorytellerGameIds).not.toHaveBeenCalled();
  });

  it("matches engine storytellers when they do not hold the Discord ST role", async () => {
    listActiveGamesForGuild.mockResolvedValue([{ id: "game-1", stRoleId: "town-st" }]);
    listEngineStorytellerGameIds.mockResolvedValue(["game-1"]);
    await expect(
      isActiveGameStoryteller(interaction({ member: { roles: ["player"] } }) as never),
    ).resolves.toBe(true);
  });
});

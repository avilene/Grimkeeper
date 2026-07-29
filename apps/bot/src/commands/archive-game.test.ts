import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@grimkeeper/database", () => ({
  prisma: {
    player: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(async () => undefined),
}));

import {
  ARCHIVE_CHANNEL_READONLY,
  ARCHIVE_ROLE_READONLY,
  applyArchiveChannelPermissions,
  archiveChannelThreadsDirectly,
  archiveGameSurfaces,
  lockThreadReadOnly,
} from "./command-context.js";

describe("archive channel permissions", () => {
  it("exports readonly overwrite shapes for @everyone and game roles", () => {
    expect(ARCHIVE_CHANNEL_READONLY.ViewChannel).toBe(true);
    expect(ARCHIVE_CHANNEL_READONLY.SendMessages).toBe(false);
    expect(ARCHIVE_CHANNEL_READONLY.SendMessagesInThreads).toBe(false);
    expect(ARCHIVE_CHANNEL_READONLY.CreatePublicThreads).toBe(false);
    expect(ARCHIVE_ROLE_READONLY.ManageThreads).toBe(false);
  });

  it("applies @everyone and game-role overwrites on a text channel", async () => {
    const edit = vi.fn(async () => undefined);
    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async () => ({
          permissionOverwrites: { edit },
        })),
      },
    };

    await expect(
      applyArchiveChannelPermissions(guild as never, "town-1", {
        channelId: "town-1",
        stRoleId: "role-st",
        playerRoleId: "role-p",
        kibRoleId: "role-k",
      }),
    ).resolves.toBe(true);

    expect(edit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(edit).toHaveBeenCalledWith("role-st", ARCHIVE_ROLE_READONLY);
    expect(edit).toHaveBeenCalledWith("role-p", ARCHIVE_ROLE_READONLY);
    expect(edit).toHaveBeenCalledWith("role-k", ARCHIVE_ROLE_READONLY);
  });

  it("returns false when the channel has no permissionOverwrites", async () => {
    const guild = {
      id: "guild-1",
      channels: { fetch: vi.fn(async () => ({ type: ChannelType.GuildText })) },
    };
    await expect(
      applyArchiveChannelPermissions(guild as never, "ch-1", { channelId: "ch-1" }),
    ).resolves.toBe(false);
  });
});

describe("lockThreadReadOnly", () => {
  it("unarchives then locks a public thread via setLocked", async () => {
    const thread = {
      archived: true,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(async () => undefined),
      setLocked: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(true);
    expect(thread.setArchived).toHaveBeenCalled();
    expect(thread.setLocked).toHaveBeenCalledWith(true, expect.any(String));
    expect(thread.edit).not.toHaveBeenCalled();
  });

  it("skips setArchived when thread is not archived", async () => {
    const thread = {
      archived: false,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(async () => undefined),
      setLocked: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(true);
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it("sets invitable: false on private threads", async () => {
    const thread = {
      archived: false,
      type: ChannelType.PrivateThread,
      setArchived: vi.fn(),
      setLocked: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(true);
    expect(thread.setLocked).toHaveBeenCalledWith(true, expect.any(String));
    expect(thread.edit).toHaveBeenCalledWith({ invitable: false });
  });

  it("returns false when setLocked throws", async () => {
    const thread = {
      archived: false,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(),
      setLocked: vi.fn(async () => { throw new Error("Missing Permissions"); }),
      edit: vi.fn(),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(false);
  });
});

describe("archiveChannelThreadsDirectly", () => {
  it("locks active and archived threads under the given channel", async () => {
    const setLocked = vi.fn(async () => undefined);
    const activeThread = {
      id: "t-active",
      parentId: "town-1",
      isThread: () => true,
      archived: false,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(),
      setLocked,
      edit: vi.fn(),
    };
    const archivedPublicThread = {
      id: "t-archived-pub",
      parentId: "town-1",
      isThread: () => true,
      archived: true,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(async () => undefined),
      setLocked,
      edit: vi.fn(),
    };
    const archivedPrivateThread = {
      id: "t-archived-priv",
      parentId: "town-1",
      isThread: () => true,
      archived: true,
      type: ChannelType.PrivateThread,
      setArchived: vi.fn(async () => undefined),
      setLocked,
      edit: vi.fn(async () => undefined),
    };

    const town = {
      id: "town-1",
      name: "town",
      type: ChannelType.GuildText,
      threads: {
        fetchArchived: vi.fn(async ({ type }: { type: string }) => ({
          threads: {
            values: () =>
              type === "public" ? [archivedPublicThread] : [archivedPrivateThread],
          },
        })),
      },
    };

    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async (id: string) => (id === "town-1" ? town : null)),
        fetchActiveThreads: vi.fn(async () => ({
          threads: { values: () => [activeThread] },
        })),
      },
    };

    const result = await archiveChannelThreadsDirectly(guild as never, "town-1");
    expect(result.threads).toBe(3);
    expect(setLocked).toHaveBeenCalledTimes(3);
  });

  it("skips threads belonging to other parent channels", async () => {
    const setLocked = vi.fn(async () => undefined);
    const otherThread = {
      id: "t-other",
      parentId: "other-channel",
      isThread: () => true,
      archived: false,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(),
      setLocked,
      edit: vi.fn(),
    };

    const town = {
      id: "town-1",
      name: "town",
      type: ChannelType.GuildText,
      threads: {
        fetchArchived: vi.fn(async () => ({ threads: { values: () => [] } })),
      },
    };

    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async (id: string) => (id === "town-1" ? town : null)),
        fetchActiveThreads: vi.fn(async () => ({
          threads: { values: () => [otherThread] },
        })),
      },
    };

    const result = await archiveChannelThreadsDirectly(guild as never, "town-1");
    expect(result.threads).toBe(0);
    expect(setLocked).not.toHaveBeenCalled();
  });
});

describe("archiveGameSurfaces", () => {
  it("applies channel overwrites and scans threads; posts archive notice", async () => {
    const townEdit = vi.fn(async () => undefined);
    const kibEdit = vi.fn(async () => undefined);

    const town = {
      id: "town-1",
      name: "town",
      isTextBased: () => true,
      isDMBased: () => false,
      isThread: () => false,
      type: ChannelType.GuildText,
      permissionOverwrites: { edit: townEdit },
      send: vi.fn(async () => undefined),
      threads: {
        fetchArchived: vi.fn(async () => ({ threads: { values: () => [] } })),
      },
    };
    const kib = {
      id: "kib-channel",
      isTextBased: () => true,
      isDMBased: () => false,
      isThread: () => false,
      type: ChannelType.GuildText,
      permissionOverwrites: { edit: kibEdit },
      send: vi.fn(async () => undefined),
      threads: {
        fetchArchived: vi.fn(async () => ({ threads: { values: () => [] } })),
      },
    };

    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "town-1") return town;
          if (id === "kib-channel") return kib;
          return null;
        }),
        fetchActiveThreads: vi.fn(async () => ({ threads: { values: () => [] } })),
      },
    };

    const game = {
      id: "game-1",
      channelId: "town-1",
      kibThreadId: "kib-channel",
      stRoleId: "role-st",
      playerRoleId: "role-p",
      kibRoleId: "role-k",
    };

    const result = await archiveGameSurfaces(guild as never, game);

    expect(result.channels).toBe(2);
    expect(townEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(kibEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(town.send).toHaveBeenCalled();
    expect(kib.send).toHaveBeenCalled();
  });
});

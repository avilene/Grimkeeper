import { ChannelType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@grimkeeper/database", () => ({
  listGameWhispers: vi.fn(async () => [{ threadId: "whisper-1" }]),
  prisma: {
    player: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(async () => undefined),
}));

import { listGameWhispers } from "@grimkeeper/database";
import {
  ARCHIVE_CHANNEL_READONLY,
  ARCHIVE_ROLE_READONLY,
  applyArchiveChannelPermissions,
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
});

describe("lockThreadReadOnly", () => {
  it("unarchives then locks a public thread", async () => {
    const thread = {
      archived: true,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(true);
    expect(thread.setArchived).toHaveBeenCalled();
    expect(thread.edit).toHaveBeenCalledWith(
      expect.objectContaining({ locked: true }),
    );
  });

  it("disables invites on private threads", async () => {
    const thread = {
      archived: false,
      type: ChannelType.PrivateThread,
      setArchived: vi.fn(),
      edit: vi.fn(async () => undefined),
    };

    await expect(lockThreadReadOnly(thread as never)).resolves.toBe(true);
    expect(thread.edit).toHaveBeenCalledWith(
      expect.objectContaining({ locked: true, invitable: false }),
    );
  });
});

describe("archiveGameSurfaces", () => {
  beforeEach(() => {
    vi.mocked(listGameWhispers).mockResolvedValue([{ threadId: "whisper-1" }] as never);
  });

  it("opens town for reading, locks public and private threads", async () => {
    const townEdit = vi.fn(async () => undefined);
    const kibEdit = vi.fn(async () => undefined);
    const lockEdit = vi.fn(async () => undefined);

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
    };
    const voting = {
      id: "voting-1",
      isThread: () => true,
      archived: false,
      type: ChannelType.PublicThread,
      setArchived: vi.fn(),
      edit: lockEdit,
    };
    const whisper = {
      id: "whisper-1",
      isThread: () => true,
      archived: true,
      type: ChannelType.PrivateThread,
      setArchived: vi.fn(async () => undefined),
      edit: lockEdit,
    };

    const channels = new Map<string, unknown>([
      ["town-1", town],
      ["kib-channel", kib],
      ["voting-1", voting],
      ["whisper-1", whisper],
    ]);

    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async (id: string) => channels.get(id) ?? null),
        fetchActiveThreads: vi.fn(async () => ({ threads: { values: () => [] } })),
      },
    };

    const game = {
      id: "game-1",
      channelId: "town-1",
      kibThreadId: "kib-channel",
      votingThreadId: "voting-1",
      stRoleId: "role-st",
      playerRoleId: "role-p",
      kibRoleId: "role-k",
    };

    const engine = {
      getState: () => ({ day: null, players: [] }),
      getStorytellerDiscordIds: () => [],
    };

    const result = await archiveGameSurfaces(guild as never, game, engine as never);

    expect(result.channels).toBe(2);
    expect(result.threads).toBe(2);
    expect(townEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(kibEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(town.send).toHaveBeenCalled();
    expect(kib.send).toHaveBeenCalled();
    expect(whisper.setArchived).toHaveBeenCalled();
    expect(lockEdit).toHaveBeenCalled();
  });
});

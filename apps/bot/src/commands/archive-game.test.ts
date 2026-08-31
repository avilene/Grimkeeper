import { ChannelType, MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@grimkeeper/database", () => ({
  resolveArchiveCategoryId: vi.fn(async () => null),
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
  formatArchiveDryRunContent,
  lockThreadReadOnly,
  moveChannelToArchiveCategory,
  replyOrEditInteraction,
  stripGameRolesFromMembers,
} from "./command-context.js";
import { DISCORD_CONTENT_LIMIT, splitDiscordContent } from "../interactions/interaction-response.js";

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

describe("moveChannelToArchiveCategory", () => {
  it("moves a text channel when parent differs", async () => {
    const setParent = vi.fn(async () => undefined);
    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async () => ({
          isDMBased: () => false,
          isThread: () => false,
          type: ChannelType.GuildText,
          parentId: "old-category",
          setParent,
        })),
      },
    };

    await expect(
      moveChannelToArchiveCategory(guild as never, "town-1", "archives-cat"),
    ).resolves.toBe(true);
    expect(setParent).toHaveBeenCalledWith("archives-cat", {
      lockPermissions: false,
      reason: "Game archived — move to Archives category.",
    });
  });

  it("skips when channel is already in the target category", async () => {
    const setParent = vi.fn();
    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async () => ({
          isDMBased: () => false,
          isThread: () => false,
          type: ChannelType.GuildText,
          parentId: "archives-cat",
          setParent,
        })),
      },
    };

    await expect(
      moveChannelToArchiveCategory(guild as never, "town-1", "archives-cat"),
    ).resolves.toBe(false);
    expect(setParent).not.toHaveBeenCalled();
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

    const removeRole = vi.fn(async () => undefined);
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
      members: {
        cache: { values: () => [] },
        removeRole,
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
    expect(result.rolesStripped).toBe(0);
    expect(townEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(kibEdit).toHaveBeenCalledWith("guild-1", ARCHIVE_CHANNEL_READONLY);
    expect(town.send).toHaveBeenCalled();
    expect(kib.send).toHaveBeenCalled();
    expect(removeRole).not.toHaveBeenCalled();
  });
});

describe("stripGameRolesFromMembers", () => {
  it("removes ST/player/kib roles from roster, storytellers, and cached kib holders", async () => {
    const removeRole = vi.fn(async () => undefined);
    const guild = {
      id: "guild-1",
      members: {
        cache: {
          values: () => [
            {
              id: "kib-user",
              roles: { cache: { has: (id: string) => id === "role-k" } },
            },
          ],
        },
        removeRole,
      },
    };
    const engine = {
      getState: () => ({
        players: [{ discordUserId: "player-1" }, { discordUserId: "dev:bot" }],
      }),
      getStorytellerDiscordIds: () => ["st-1"],
    };

    const result = await stripGameRolesFromMembers(
      guild as never,
      {
        channelId: "town-1",
        stRoleId: "role-st",
        playerRoleId: "role-p",
        kibRoleId: "role-k",
      },
      engine as never,
    );

    expect(result.users).toBe(3);
    expect(removeRole).toHaveBeenCalledTimes(9);
    expect(removeRole).toHaveBeenCalledWith({ user: "player-1", role: "role-st" });
    expect(removeRole).toHaveBeenCalledWith({ user: "kib-user", role: "role-k" });
    expect(removeRole).not.toHaveBeenCalledWith(expect.objectContaining({ user: "dev:bot" }));
  });
});

describe("formatArchiveDryRunContent", () => {
  function threadLines(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      name: `whisper-${i}`,
      mention: `<#${100000000000000000n + BigInt(i)}>`,
      action: "unarchive → lock (private)",
    }));
  }

  it("lists only channel and thread mentions, not per-item actions", () => {
    const text = formatArchiveDryRunContent({
      channelLines: [
        {
          name: "town",
          mention: "<#town-1>",
          action:
            "@everyone: ViewChannel ✓, SendMessages ✗ — move to Archives category \"Archives\"",
        },
      ],
      threadLines: [
        { name: "Voting", mention: "<#t-vote>", action: "lock (public)" },
      ],
    });
    expect(text).toContain("**Archive dry run**");
    expect(text).toContain("These would be locked read-only");
    expect(text).toContain("**Channels (1)**");
    expect(text).toContain("• <#town-1>");
    expect(text).toContain("**Threads (1)**");
    expect(text).toContain("• <#t-vote>");
    expect(text).not.toContain("ViewChannel");
    expect(text).not.toContain("lock (public)");
    expect(text).not.toContain("`town`");
    expect(text.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
  });

  it("lists ST/player/kib roles that would be stripped from members", () => {
    const text = formatArchiveDryRunContent({
      channelLines: [{ name: "town", mention: "<#town-1>", action: "lock posting" }],
      threadLines: [],
      roleLines: [
        { name: "st-town", mention: "<@&role-st>", action: "remove from members" },
        { name: "p-town", mention: "<@&role-p>", action: "remove from members" },
        { name: "spec-town", mention: "<@&role-k>", action: "remove from members" },
      ],
    });
    expect(text).toContain("ST/player/kib roles would be removed from everyone who has them");
    expect(text).toContain("**Roles (3)**");
    expect(text).toContain("• <@&role-st>");
    expect(text).toContain("• <@&role-p>");
    expect(text).toContain("• <@&role-k>");
  });

  it("fits a typical game's thread list in one Discord message", () => {
    const text = formatArchiveDryRunContent({
      channelLines: [{ name: "town", mention: "<#town-1>", action: "lock posting" }],
      threadLines: threadLines(40),
    });
    expect(text).toContain("**Threads (40)**");
    expect(text.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
  });

  it("splits a very large thread list into Discord-legal chunks", () => {
    const text = formatArchiveDryRunContent({
      channelLines: [{ name: "town", mention: "<#town-1>", action: "lock posting" }],
      threadLines: threadLines(90),
    });
    expect(text.length).toBeGreaterThan(DISCORD_CONTENT_LIMIT);
    const chunks = splitDiscordContent(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
    }
  });

  it("edits the first chunk and follow-ups the rest (ephemeral)", async () => {
    const content = formatArchiveDryRunContent({
      channelLines: [{ name: "town", mention: "<#town-1>", action: "lock posting" }],
      threadLines: threadLines(90),
    });
    const editReply = vi.fn(async (_payload: { content: string }) => undefined);
    const followUp = vi.fn(async (_payload: { content: string; flags?: number }) => undefined);
    const interaction = {
      deferred: true,
      replied: true,
      editReply,
      followUp,
      reply: vi.fn(),
    };

    await replyOrEditInteraction(interaction as never, {
      content,
      flags: MessageFlags.Ephemeral,
    });

    expect(editReply).toHaveBeenCalledOnce();
    const first = editReply.mock.calls[0]?.[0];
    expect(first?.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
    expect(followUp.mock.calls.length).toBeGreaterThan(0);
    for (const [payload] of followUp.mock.calls) {
      expect(payload.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
      expect(payload.flags).toBe(MessageFlags.Ephemeral);
    }
  });
});

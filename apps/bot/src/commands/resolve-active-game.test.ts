import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";

const getActiveGameForVenue = vi.fn();
const listActiveGamesForGuild = vi.fn();

vi.mock("@grimkeeper/database", () => ({
  getActiveGameForVenue: (...args: unknown[]) => getActiveGameForVenue(...args),
  listActiveGamesForGuild: (...args: unknown[]) => listActiveGamesForGuild(...args),
  appendGameEvent: vi.fn(),
  getActiveGameForChannel: vi.fn(),
  getGameForChannelIncludingEnded: vi.fn(),
  getGameEvents: vi.fn(),
  prisma: {},
  resolveArchiveCategoryId: vi.fn(),
  syncGameProjectionFromEngine: vi.fn(),
  listGameWhispers: vi.fn(),
}));

import {
  resolveActiveGameForInteraction,
  resolveInteractionVenueChannelIds,
} from "./command-context.js";

describe("resolveInteractionVenueChannelIds", () => {
  it("includes thread parent when interaction channel is a thread", async () => {
    const ids = await resolveInteractionVenueChannelIds({
      channelId: "thread-1",
      channel: {
        isThread: () => true,
        parentId: "town-1",
      } as never,
      guild: null,
    });
    expect(ids).toEqual(["thread-1", "town-1"]);
  });

  it("re-fetches thread parent when cache is missing", async () => {
    const ids = await resolveInteractionVenueChannelIds({
      channelId: "thread-1",
      channel: null,
      guild: {
        channels: {
          fetch: vi.fn(async (id: string) =>
            id === "thread-1"
              ? { isThread: () => true, parentId: "town-1" }
              : null,
          ),
        },
      } as never,
    });
    expect(ids).toEqual(["thread-1", "town-1"]);
  });
});

describe("resolveActiveGameForInteraction", () => {
  it("matches town channel via DB venue lookup", async () => {
    getActiveGameForVenue.mockReset();
    getActiveGameForVenue.mockImplementation(async (_guildId: string, channelId: string) =>
      channelId === "town-1" ? { id: "game-1", channelId: "town-1", phase: "day" } : null,
    );
    listActiveGamesForGuild.mockReset();

    const game = await resolveActiveGameForInteraction({
      guildId: "guild-1",
      channelId: "town-1",
      channel: { isThread: () => false } as never,
      guild: null,
    });

    expect(game?.id).toBe("game-1");
  });

  it("falls back to Discord kib discovery when DB ids are missing", async () => {
    getActiveGameForVenue.mockReset();
    getActiveGameForVenue.mockResolvedValue(null);
    listActiveGamesForGuild.mockResolvedValue([
      {
        id: "game-1",
        guildId: "guild-1",
        channelId: "town-1",
        phase: "day",
        kibThreadId: null,
        votingThreadId: null,
        players: [],
      },
    ]);

    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "kib-1") {
            return {
              id: "kib-1",
              isThread: (): boolean => false,
              isTextBased: (): boolean => true,
              isDMBased: (): boolean => false,
              type: ChannelType.GuildText,
            };
          }
          if (id === "town-1") {
            return {
              id: "town-1",
              name: "game-one",
              type: ChannelType.GuildText,
              isThread: (): boolean => false,
            };
          }
          return null;
        }),
        fetchActiveThreads: vi.fn(async () => ({ threads: new Map() })),
      },
    };

    // getStorytellerThread looks up kib by stored id first, then by name under town.
    // Simulate a dedicated kib channel stored nowhere in DB but discoverable via kib-{town} thread under town... 
    // For dedicated kib channel, getStorytellerThread checks kibThreadId first.
    // Patch: store kib as thread under town with matching name.
    (guild.channels.fetchActiveThreads as ReturnType<typeof vi.fn>).mockResolvedValue({
      threads: new Map([
        [
          "kib-1",
          {
            id: "kib-1",
            name: "kib-game-one",
            parentId: "town-1",
            isThread: () => true,
          },
        ],
      ]),
    });

    const game = await resolveActiveGameForInteraction({
      guildId: "guild-1",
      channelId: "kib-1",
      channel: {
        isThread: () => true,
        parentId: "town-1",
      } as never,
      guild: guild as never,
    });

    expect(game?.id).toBe("game-1");
  });
});

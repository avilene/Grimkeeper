import { describe, expect, it, vi } from "vitest";

import { findTownVoteThread, resolveVotingChannel } from "./command-context.js";

const GAME_ID = "abcdef12-3456-7890";
const TOWN_ID = "town-1";

function thread(id: string, name: string, parentId = TOWN_ID) {
  return {
    id,
    name,
    parentId,
    isThread: () => true,
  };
}

describe("findTownVoteThread", () => {
  it("prefers stored votingThreadId over name matches", async () => {
    const stored = thread("vote-stored", "Town Voting");
    const other = thread("vote-other", "Town Voting · abcdef");
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => (id === "vote-stored" ? stored : null)),
        fetchActiveThreads: vi.fn(async () => ({
          threads: {
            find: () => other,
          },
        })),
      },
    };

    await expect(
      findTownVoteThread(guild as never, TOWN_ID, GAME_ID, "vote-stored"),
    ).resolves.toEqual(stored);
    expect(guild.channels.fetchActiveThreads).not.toHaveBeenCalled();
  });

  it("does not treat Rules / Claims / Whisper / ST threads as Town Voting", async () => {
    const voting = thread("vote-1", "Town Voting · abcdef");
    const guild = {
      channels: {
        fetchActiveThreads: vi.fn(async () => ({
          threads: {
            find: (predicate: (t: { parentId: string; name: string }) => boolean) => {
              const candidates = [
                thread("rules-1", "Rules · abcdef"),
                thread("claims-1", "Public Claims · abcdef"),
                thread("whisper-1", "Whisper Declaration · abcdef"),
                thread("st-1", "ST Alice · abcdef"),
                voting,
              ];
              return candidates.find(predicate);
            },
          },
        })),
        fetch: vi.fn(),
      },
    };

    await expect(findTownVoteThread(guild as never, TOWN_ID, GAME_ID, null)).resolves.toEqual(
      voting,
    );
  });

  it("matches clean Town Voting names", async () => {
    const voting = thread("vote-1", "Town Voting");
    const guild = {
      channels: {
        fetchActiveThreads: vi.fn(async () => ({
          threads: {
            find: (predicate: (t: { parentId: string; name: string }) => boolean) =>
              [voting].find(predicate),
          },
        })),
        fetch: vi.fn(),
      },
    };

    await expect(findTownVoteThread(guild as never, TOWN_ID, GAME_ID, null)).resolves.toEqual(
      voting,
    );
  });

  it("returns null when only non-voting town surfaces exist", async () => {
    const guild = {
      channels: {
        fetchActiveThreads: vi.fn(async () => ({
          threads: {
            find: (predicate: (t: { parentId: string; name: string }) => boolean) => {
              const candidates = [
                thread("rules-1", "Rules · abcdef"),
                thread("claims-1", "Public Claims · abcdef"),
              ];
              return candidates.find(predicate);
            },
          },
        })),
        fetch: vi.fn(async () => ({
          type: 0,
          isTextBased: () => true,
          isDMBased: () => false,
          isThread: () => false,
          threads: {
            fetchArchived: vi.fn(async () => ({
              threads: { find: () => undefined },
            })),
          },
        })),
      },
    };

    await expect(findTownVoteThread(guild as never, TOWN_ID, GAME_ID, null)).resolves.toBeNull();
  });
});

describe("resolveVotingChannel", () => {
  it("prefers game.votingThreadId over a stale day.discordThreadId", async () => {
    const voting = thread("vote-1", "Town Voting");
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "vote-1") return voting;
          if (id === "rules-stale") return thread("rules-stale", "Rules");
          return null;
        }),
        fetchActiveThreads: vi.fn(),
      },
    };
    const engine = {
      getState: () => ({
        townMode: true,
        day: { discordThreadId: "rules-stale" },
      }),
    };

    await expect(
      resolveVotingChannel(
        guild as never,
        { id: GAME_ID, channelId: TOWN_ID, votingThreadId: "vote-1" },
        engine as never,
      ),
    ).resolves.toEqual(voting);
    expect(guild.channels.fetchActiveThreads).not.toHaveBeenCalled();
  });

  it("ignores a stale day.discordThreadId that is no longer named Town Voting", async () => {
    const voting = thread("vote-1", "Town Voting · abcdef");
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === "rules-stale") return thread("rules-stale", "Rules · abcdef");
          return null;
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: {
            find: (predicate: (t: { parentId: string; name: string }) => boolean) => {
              return [voting].find(predicate);
            },
          },
        })),
      },
    };
    const engine = {
      getState: () => ({
        townMode: true,
        day: { discordThreadId: "rules-stale" },
      }),
    };

    await expect(
      resolveVotingChannel(
        guild as never,
        { id: GAME_ID, channelId: TOWN_ID, votingThreadId: null },
        engine as never,
      ),
    ).resolves.toEqual(voting);
  });

  it("does not fall back to the town parent channel when Voting is missing", async () => {
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === TOWN_ID) {
            return {
              id: TOWN_ID,
              type: 0,
              isTextBased: () => true,
              isDMBased: () => false,
              isThread: () => false,
              threads: {
                fetchArchived: vi.fn(async () => ({
                  threads: { find: () => undefined },
                })),
              },
            };
          }
          return null;
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: { find: () => undefined },
        })),
      },
    };
    const engine = {
      getState: () => ({
        townMode: true,
        day: null,
      }),
    };

    await expect(
      resolveVotingChannel(
        guild as never,
        { id: GAME_ID, channelId: TOWN_ID, votingThreadId: null },
        engine as never,
      ),
    ).resolves.toBeNull();
  });
});

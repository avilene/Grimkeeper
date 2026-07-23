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

    await expect(findTownVoteThread(guild as never, TOWN_ID, GAME_ID)).resolves.toEqual(voting);
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

    await expect(findTownVoteThread(guild as never, TOWN_ID, GAME_ID)).resolves.toBeNull();
  });
});

describe("resolveVotingChannel", () => {
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
      resolveVotingChannel(guild as never, { id: GAME_ID, channelId: TOWN_ID }, engine as never),
    ).resolves.toEqual(voting);
  });

  it("does not fall back to the town parent channel when Voting is missing", async () => {
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => {
          if (id === TOWN_ID) {
            return {
              id: TOWN_ID,
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
      resolveVotingChannel(guild as never, { id: GAME_ID, channelId: TOWN_ID }, engine as never),
    ).resolves.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@grimkeeper/database", async () => {
  const actual = await vi.importActual<typeof import("@grimkeeper/database")>("@grimkeeper/database");
  return {
    ...actual,
    prisma: {
      player: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn(),
      },
      game: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

import { prisma } from "@grimkeeper/database";
import { findPersonalPlayerThread } from "./command-context.js";

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

describe("findPersonalPlayerThread", () => {
  beforeEach(() => {
    vi.mocked(prisma.player.findUnique).mockReset();
  });

  it("prefers stored stThreadId over name matches", async () => {
    const stored = thread("st-stored", "ST Alice");
    const guild = {
      channels: {
        fetch: vi.fn(async (id: string) => (id === "st-stored" ? stored : null)),
        fetchActiveThreads: vi.fn(),
      },
    };

    await expect(
      findPersonalPlayerThread(guild as never, TOWN_ID, GAME_ID, "Alice", undefined, "st-stored"),
    ).resolves.toEqual(stored);
    expect(guild.channels.fetchActiveThreads).not.toHaveBeenCalled();
  });

  it("falls back to legacy ST name with short game id", async () => {
    const legacy = thread("st-legacy", "ST Alice · abcdef");
    const index = new Map([["ST Alice · abcdef", legacy as never]]);

    await expect(
      findPersonalPlayerThread(
        { channels: { fetch: vi.fn() } } as never,
        TOWN_ID,
        GAME_ID,
        "Alice",
        index,
        null,
      ),
    ).resolves.toEqual(legacy);
  });

  it("falls back to clean ST name", async () => {
    const clean = thread("st-clean", "ST Alice");
    const index = new Map([["ST Alice", clean as never]]);

    await expect(
      findPersonalPlayerThread(
        { channels: { fetch: vi.fn() } } as never,
        TOWN_ID,
        GAME_ID,
        "Alice",
        index,
        null,
      ),
    ).resolves.toEqual(clean);
  });
});

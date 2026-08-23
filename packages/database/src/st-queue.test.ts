import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    stQueueBoard: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "./client.js";
import { parseScriptImageUrls, resolveQueueThreadId, serializeScriptImageUrls } from "./st-queue.js";

describe("script image url helpers", () => {
  it("round-trips urls and dedupes", () => {
    const raw = serializeScriptImageUrls([
      "https://a.example/1.png",
      " https://a.example/1.png ",
      "https://b.example/2.png",
      "",
    ]);
    expect(parseScriptImageUrls(raw)).toEqual([
      "https://a.example/1.png",
      "https://b.example/2.png",
    ]);
  });

  it("returns empty on invalid json", () => {
    expect(parseScriptImageUrls("not-json")).toEqual([]);
  });
});

describe("resolveQueueThreadId", () => {
  afterEach(() => {
    vi.mocked(prisma.stQueueBoard.findUnique).mockReset();
    delete process.env.ST_QUEUE_THREAD_ID;
  });

  it("prefers the DB board thread over env", async () => {
    process.env.ST_QUEUE_THREAD_ID = "env-thread";
    vi.mocked(prisma.stQueueBoard.findUnique).mockResolvedValue({
      threadId: "db-thread",
    } as never);
    expect(await resolveQueueThreadId("guild-1")).toBe("db-thread");
  });

  it("falls back to ST_QUEUE_THREAD_ID when no board exists", async () => {
    process.env.ST_QUEUE_THREAD_ID = "env-thread";
    vi.mocked(prisma.stQueueBoard.findUnique).mockResolvedValue(null);
    expect(await resolveQueueThreadId("guild-1")).toBe("env-thread");
  });

  it("returns null when neither DB nor env is set", async () => {
    vi.mocked(prisma.stQueueBoard.findUnique).mockResolvedValue(null);
    expect(await resolveQueueThreadId("guild-1")).toBeNull();
  });
});

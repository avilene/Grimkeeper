import { describe, expect, it } from "vitest";

import {
  parseStQueueButtonCustomId,
  parseStQueueModalCustomId,
  parseStQueueSelectCustomId,
  stQueueButtonCustomId,
  stQueueModalCustomId,
  stQueueSelectCustomId,
  formatQueueEntryBlock,
  buildQueueStatusContent,
  shouldRepostQueuePanel,
} from "./st-queue-board.js";

describe("st queue custom ids", () => {
  it("round-trips button ids", () => {
    expect(parseStQueueButtonCustomId(stQueueButtonCustomId("join"))).toEqual({
      action: "join",
      entryId: undefined,
    });
    expect(parseStQueueButtonCustomId(stQueueButtonCustomId("edit", "abc123"))).toEqual({
      action: "edit",
      entryId: "abc123",
    });
  });

  it("parses modal ids", () => {
    expect(parseStQueueModalCustomId(stQueueModalCustomId("join"))).toEqual({ kind: "join" });
    const editId = stQueueModalCustomId("edit", "entry99");
    expect(parseStQueueModalCustomId(editId)).toEqual({ kind: "edit", entryId: "entry99" });
  });

  it("parses user select ids", () => {
    expect(parseStQueueSelectCustomId(stQueueSelectCustomId("co_st", "e1"))).toEqual({
      kind: "co_st",
      entryId: "e1",
    });
  });
});

describe("shouldRepostQueuePanel", () => {
  const panel = { id: "panel", author: { bot: true } };
  const human = (id: string) => ({ id, author: { bot: false } });
  const bot = (id: string) => ({ id, author: { bot: true } });

  it("keeps the panel when it is newest among humans", () => {
    // newest-first: other bots, then panel, then older humans
    expect(shouldRepostQueuePanel([bot("b2"), panel, human("h1")], "panel")).toBe(false);
  });

  it("reposts when a human message is newer than the panel", () => {
    expect(shouldRepostQueuePanel([human("h2"), panel, human("h1")], "panel")).toBe(true);
  });

  it("ignores newer bot messages when deciding", () => {
    expect(shouldRepostQueuePanel([bot("b3"), bot("b2"), panel], "panel")).toBe(false);
  });

  it("reposts when the panel is missing from the recent window", () => {
    expect(shouldRepostQueuePanel([human("h1"), bot("b1")], "panel")).toBe(true);
  });
});

describe("st queue formatting", () => {
  it("formats status summary", () => {
    const text = buildQueueStatusContent(
      [
        {
          id: "1",
          boardId: "b",
          guildId: "g",
          ownerDiscordId: "111",
          scriptName: "Trouble Brewing",
          scriptLink: "",
          description: "",
          scriptImageUrls: "[]",
          status: "open",
          position: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [
            { id: "m1", entryId: "1", discordUserId: "222", role: "player", createdAt: new Date() },
          ],
        },
      ] as never,
      "999",
    );
    expect(text).toContain("Trouble Brewing");
    expect(text).toContain("<#999>");
    expect(text).toContain("players 1");
  });

  it("formats entry block with co-st and images", () => {
    const block = formatQueueEntryBlock(
      {
        id: "1",
        boardId: "b",
        guildId: "g",
        ownerDiscordId: "111",
        scriptName: "Sects",
        scriptLink: "https://example.com/script",
        description: "Friday night",
        scriptImageUrls: JSON.stringify(["https://cdn.example/a.png"]),
        status: "open",
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        members: [
          { id: "m1", entryId: "1", discordUserId: "222", role: "co_st", createdAt: new Date() },
        ],
      } as never,
      0,
    );
    expect(block).toContain("Sects");
    expect(block).toContain("<@222>");
    expect(block).toContain("Images: 1");
  });
});

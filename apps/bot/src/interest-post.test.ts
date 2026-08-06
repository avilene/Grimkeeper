import { describe, expect, it } from "vitest";

import {
  guessScriptLabel,
  interestButtonCustomId,
  interestConfirmCustomId,
  interestModalCustomId,
  parseInterestButtonCustomId,
  parseInterestConfirmCustomId,
  parseInterestModalCustomId,
  buildInterestEmbed,
} from "./interest-post.js";

describe("interest custom ids", () => {
  it("round-trips public and owner buttons", () => {
    expect(parseInterestButtonCustomId(interestButtonCustomId("playing", "abc"))).toEqual({
      action: "playing",
      interestId: "abc",
    });
    expect(parseInterestButtonCustomId(interestButtonCustomId("edit", "xyz"))).toEqual({
      action: "edit",
      interestId: "xyz",
    });
  });

  it("parses edit modal ids", () => {
    const id = interestModalCustomId("post99");
    expect(parseInterestModalCustomId(id)).toEqual({ interestId: "post99" });
  });

  it("parses delete confirm ids", () => {
    expect(parseInterestConfirmCustomId(interestConfirmCustomId("delete-yes", "p1"))).toEqual({
      action: "delete-yes",
      interestId: "p1",
    });
  });
});

describe("guessScriptLabel", () => {
  it("uses slug from botcscripts URL when non-numeric", () => {
    expect(guessScriptLabel("https://botcscripts.com/script/sects-and-violets", "Title")).toBe(
      "Sects And Violets",
    );
  });

  it("falls back to title for numeric script ids", () => {
    expect(guessScriptLabel("https://botcscripts.com/script/123", "Trouble Brewing")).toBe(
      "Trouble Brewing",
    );
  });

  it("falls back for non-botcscripts URLs", () => {
    expect(guessScriptLabel("https://example.com/x", "My Script")).toBe("My Script");
  });
});

describe("buildInterestEmbed", () => {
  it("includes counts and closed header", () => {
    const open = buildInterestEmbed({
      id: "1",
      guildId: "g",
      channelId: "c",
      messageId: "m",
      ownerId: "111",
      title: "Trouble Brewing",
      description: "Looking at next week.",
      scriptUrl: "https://botcscripts.com/script/123",
      imageUrl: "",
      maxPlayers: 12,
      closed: false,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      signups: [
        {
          id: "s1",
          interestId: "1",
          userId: "a",
          state: "playing",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "s2",
          interestId: "1",
          userId: "b",
          state: "kib",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    expect(open.data.title).toBe("🎲 Interest Check");
    expect(open.data.description).toContain("Playing (1/12)");
    expect(open.data.description).toContain("KIB (1)");

    const closed = buildInterestEmbed({
      id: "1",
      guildId: "g",
      channelId: "c",
      messageId: "m",
      ownerId: "111",
      title: "Trouble Brewing",
      description: "",
      scriptUrl: "",
      imageUrl: "",
      maxPlayers: null,
      closed: true,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      signups: [],
    });
    expect(closed.data.title).toBe("🔒 Interest Check (Closed)");
  });
});

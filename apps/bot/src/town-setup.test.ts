import { describe, expect, it } from "vitest";

import { parseUserMentionsFromString } from "./town-setup.js";

describe("parseUserMentionsFromString", () => {
  it("parses ordered user mentions from a slash-command string", () => {
    expect(
      parseUserMentionsFromString(
        "<@123456789012345678> nominates <@234567890123456789> and <@345678901234567890>",
      ),
    ).toEqual(["123456789012345678", "234567890123456789", "345678901234567890"]);
  });

  it("supports nickname mentions and deduplicates while preserving first order", () => {
    expect(
      parseUserMentionsFromString(
        "<@!456789012345678901> <@456789012345678901> <@567890123456789012>",
      ),
    ).toEqual(["456789012345678901", "567890123456789012"]);
  });

  it("returns an empty list when no mentions are present", () => {
    expect(parseUserMentionsFromString("Alice Bob Carol")).toEqual([]);
  });
});

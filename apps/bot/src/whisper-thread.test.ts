import { describe, expect, it } from "vitest";

import {
  defaultWhisperName,
  formatWhisperDayMarker,
  formatWhisperOpenMessage,
} from "./whisper-thread.js";

describe("whisper thread helpers", () => {
  it("defaults the name to both players, with optional NW", () => {
    expect(defaultWhisperName("Alice", "Bob", false)).toBe("Alice & Bob");
    expect(defaultWhisperName("Alice", "Bob", true)).toBe("Alice & Bob NW");
  });

  it("formats day markers and open messages", () => {
    expect(formatWhisperDayMarker(2)).toBe("## Day 2");
    expect(formatWhisperOpenMessage("1", "2", "day", 1)).toContain("## Day 1");
    expect(formatWhisperOpenMessage("1", "2", "day", 1)).toContain("<@1>");
    expect(formatWhisperOpenMessage("1", "2", "day", 1)).toContain("Storyteller can see");
    expect(formatWhisperOpenMessage("1", "2", "night", 3)).toContain("## Night 3");
  });
});

import { describe, expect, it } from "vitest";

import { formatKibPhaseHeader, formatVoteThreadDayStartMessage } from "./town-day.js";

describe("formatKibPhaseHeader", () => {
  it("formats day and night headers", () => {
    expect(formatKibPhaseHeader("day", 2)).toBe("## Day 2");
    expect(formatKibPhaseHeader("night", 3)).toBe("## Night 3");
  });
});

describe("formatVoteThreadDayStartMessage", () => {
  it("starts with a day header", () => {
    expect(formatVoteThreadDayStartMessage(2)).toMatch(/^## Day 2\n\n/);
  });

  it("uses open on day 1 and open again on later days", () => {
    expect(formatVoteThreadDayStartMessage(1)).toContain("nominations are open.");
    expect(formatVoteThreadDayStartMessage(1)).not.toContain("open again");
    expect(formatVoteThreadDayStartMessage(3)).toContain("nominations are open again.");
  });
});

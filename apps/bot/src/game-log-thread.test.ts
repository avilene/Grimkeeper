import { describe, expect, it } from "vitest";

import { formatGameLogLine, logThreadName } from "./game-log-thread.js";

describe("logThreadName", () => {
  it("includes short game id so games do not share log threads", () => {
    expect(logThreadName("town-square", "abcdef12-3456")).toBe("log-town-square · abcdef");
  });

  it("truncates to 100 characters", () => {
    const longName = "x".repeat(120);
    expect(logThreadName(longName, "abcdef12-3456")).toHaveLength(100);
    expect(logThreadName(longName, "abcdef12-3456").startsWith("log-")).toBe(true);
  });
});

describe("formatGameLogLine", () => {
  it("includes ISO timestamp prefix", () => {
    const line = formatGameLogLine("test event", new Date("2026-07-17T10:30:00.000Z"));
    expect(line).toBe("`[2026-07-17 10:30:00]` test event");
  });
});

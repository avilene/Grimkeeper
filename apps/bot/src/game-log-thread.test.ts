import { describe, expect, it } from "vitest";

import { formatGameLogLine, logThreadName } from "./game-log-thread.js";

describe("logThreadName", () => {
  it("prefixes channel name with log-", () => {
    expect(logThreadName("town-square")).toBe("log-town-square");
  });

  it("truncates to 100 characters", () => {
    const longName = "x".repeat(120);
    expect(logThreadName(longName)).toHaveLength(100);
    expect(logThreadName(longName).startsWith("log-")).toBe(true);
  });
});

describe("formatGameLogLine", () => {
  it("includes ISO timestamp prefix", () => {
    const line = formatGameLogLine("test event", new Date("2026-07-17T10:30:00.000Z"));
    expect(line).toBe("`[2026-07-17 10:30:00]` test event");
  });
});

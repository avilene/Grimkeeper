import { describe, expect, it } from "vitest";

import {
  isStorytellerThread,
  kibThreadName,
  personalPlayerThreadName,
  stPlayerThreadName,
  storytellerThreadName,
} from "./commands/command-context.js";

describe("kibThreadName", () => {
  it("prefixes channel name with kib-", () => {
    expect(kibThreadName("town-square")).toBe("kib-town-square");
  });

  it("includes short game id when provided", () => {
    expect(kibThreadName("town-square", "abcdef12-3456")).toBe("kib-town-square · abcdef");
  });

  it("truncates to 100 characters", () => {
    const longName = "x".repeat(120);
    expect(kibThreadName(longName, "abcdef12-3456")).toHaveLength(100);
    expect(kibThreadName(longName).startsWith("kib-")).toBe(true);
  });
});

describe("stPlayerThreadName", () => {
  it("uses ST displayName format", () => {
    expect(stPlayerThreadName("Alice")).toBe("ST Alice");
  });

  it("truncates to 100 characters", () => {
    const longName = "y".repeat(120);
    expect(stPlayerThreadName(longName)).toHaveLength(100);
    expect(stPlayerThreadName(longName).startsWith("ST ")).toBe(true);
  });
});

describe("personalPlayerThreadName", () => {
  it("includes game id so games do not share threads", () => {
    expect(personalPlayerThreadName("abcdef12-3456", "Alice")).toBe("ST Alice · abcdef");
  });
});

describe("storytellerThreadName", () => {
  it("returns kib name with channel and game id", () => {
    expect(storytellerThreadName("clocktower", "abcdef12-3456")).toBe("kib-clocktower · abcdef");
  });

  it("falls back without parent channel name", () => {
    expect(storytellerThreadName(undefined, "abcdef12-3456")).toBe("kib · abcdef");
    expect(storytellerThreadName()).toBe("kib");
  });
});

describe("isStorytellerThread", () => {
  it("matches kib thread by expected name", () => {
    const parentId = "channel-1";
    const candidate = { parentId, name: "kib-town · abcdef" };
    expect(isStorytellerThread(candidate, parentId, "town", "abcdef12-3456")).toBe(true);
    expect(isStorytellerThread(candidate, parentId, "other", "abcdef12-3456")).toBe(false);
    expect(isStorytellerThread({ parentId, name: "kib-town" }, parentId, "town", "abcdef12-3456")).toBe(
      false,
    );
  });
});

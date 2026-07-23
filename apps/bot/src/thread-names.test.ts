import { describe, expect, it } from "vitest";

import {
  isStorytellerThread,
  kibThreadName,
  legacyKibThreadName,
  legacyPersonalPlayerThreadName,
  personalPlayerThreadName,
  stPlayerThreadName,
  storytellerThreadName,
} from "./commands/command-context.js";

describe("kibThreadName", () => {
  it("prefixes channel name with kib-", () => {
    expect(kibThreadName("town-square")).toBe("kib-town-square");
  });

  it("ignores game id in the clean name", () => {
    expect(kibThreadName("town-square", "abcdef12-3456")).toBe("kib-town-square");
  });

  it("keeps a legacy name with short game id", () => {
    expect(legacyKibThreadName("town-square", "abcdef12-3456")).toBe("kib-town-square · abcdef");
  });

  it("truncates to 100 characters", () => {
    const longName = "x".repeat(120);
    expect(kibThreadName(longName)).toHaveLength(100);
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
  it("uses the clean ST name without game id", () => {
    expect(personalPlayerThreadName("abcdef12-3456", "Alice")).toBe("ST Alice");
  });

  it("keeps a legacy name with short game id", () => {
    expect(legacyPersonalPlayerThreadName("abcdef12-3456", "Alice")).toBe("ST Alice · abcdef");
  });
});

describe("storytellerThreadName", () => {
  it("returns kib name with channel only", () => {
    expect(storytellerThreadName("clocktower", "abcdef12-3456")).toBe("kib-clocktower");
  });

  it("falls back without parent channel name", () => {
    expect(storytellerThreadName(undefined, "abcdef12-3456")).toBe("kib");
    expect(storytellerThreadName()).toBe("kib");
  });
});

describe("isStorytellerThread", () => {
  it("matches clean kib thread names", () => {
    const parentId = "channel-1";
    const candidate = { parentId, name: "kib-town" };
    expect(isStorytellerThread(candidate, parentId, "town", "abcdef12-3456")).toBe(true);
    expect(isStorytellerThread(candidate, parentId, "other", "abcdef12-3456")).toBe(false);
  });

  it("matches legacy kib thread names with short game id", () => {
    const parentId = "channel-1";
    const candidate = { parentId, name: "kib-town · abcdef" };
    expect(isStorytellerThread(candidate, parentId, "town", "abcdef12-3456")).toBe(true);
  });
});

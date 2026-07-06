import { afterEach, describe, expect, it } from "vitest";

import {
  isStorytellerThread,
  kibThreadName,
  stPlayerThreadName,
  storytellerThreadName,
  STORYTELLER_THREAD_NAME,
} from "./commands/command-context.js";

describe("kibThreadName", () => {
  it("prefixes channel name with kib-", () => {
    expect(kibThreadName("town-square")).toBe("kib-town-square");
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

describe("storytellerThreadName", () => {
  const original = process.env.BOT_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = original;
    }
  });

  it("returns kib name in minimal mode", () => {
    process.env.BOT_MODE = "minimal";
    expect(storytellerThreadName("clocktower")).toBe("kib-clocktower");
  });

  it("returns full-mode ST thread name otherwise", () => {
    process.env.BOT_MODE = "full";
    expect(storytellerThreadName("clocktower")).toBe(STORYTELLER_THREAD_NAME);
    delete process.env.BOT_MODE;
    expect(storytellerThreadName("clocktower")).toBe(STORYTELLER_THREAD_NAME);
  });
});

describe("isStorytellerThread", () => {
  const original = process.env.BOT_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = original;
    }
  });

  it("matches kib thread in minimal mode", () => {
    process.env.BOT_MODE = "minimal";
    const parentId = "channel-1";
    const candidate = { parentId, name: "kib-town" };
    expect(isStorytellerThread(candidate, parentId, "town")).toBe(true);
    expect(isStorytellerThread(candidate, parentId, "other")).toBe(false);
  });

  it("matches ST and the gang in full mode", () => {
    process.env.BOT_MODE = "full";
    const parentId = "channel-1";
    const candidate = { parentId, name: STORYTELLER_THREAD_NAME };
    expect(isStorytellerThread(candidate, parentId, "town")).toBe(true);
    expect(isStorytellerThread({ parentId, name: "kib-town" }, parentId, "town")).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { formatErrorForDiscord, getErrorChannelId } from "./error-reporter.js";

describe("getErrorChannelId", () => {
  const original = process.env.ERROR_CHANNEL_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ERROR_CHANNEL_ID;
    } else {
      process.env.ERROR_CHANNEL_ID = original;
    }
  });

  it("returns null when unset", () => {
    delete process.env.ERROR_CHANNEL_ID;
    expect(getErrorChannelId()).toBeNull();
  });

  it("returns trimmed channel id", () => {
    process.env.ERROR_CHANNEL_ID = "  1234567890  ";
    expect(getErrorChannelId()).toBe("1234567890");
  });
});

describe("formatErrorForDiscord", () => {
  it("includes source, message, and stack", () => {
    const error = new Error("boom");
    const text = formatErrorForDiscord("interaction.failed", error, { guildId: "g1" });
    expect(text).toContain("**[interaction.failed]**");
    expect(text).toContain("boom");
    expect(text).toContain("guildId: g1");
    expect(text).toContain("```");
  });

  it("truncates very long messages", () => {
    const error = new Error("x".repeat(5000));
    const text = formatErrorForDiscord("process.uncaughtException", error);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("truncated");
  });
});

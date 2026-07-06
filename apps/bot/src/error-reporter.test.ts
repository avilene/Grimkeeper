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
  it("includes source, yaml meta block, message block, and stack block", () => {
    const error = new Error("boom");
    const text = formatErrorForDiscord("interaction.failed", error, { guildId: "g1" });
    expect(text).toContain("**[interaction.failed]**");
    expect(text).toContain("```yaml");
    expect(text).toContain("source: interaction.failed");
    expect(text).toContain("time:");
    expect(text).toContain("guildId: g1");
    expect(text).toContain("type: Error");
    expect(text).toContain("```\nboom\n```");
    expect(text).toContain("Error: boom");
  });

  it("includes discord api code in meta when present", () => {
    const error = Object.assign(new Error("Invalid Form Body"), { code: 50_035, status: 400 });
    const text = formatErrorForDiscord("commands.register.failed", error);
    expect(text).toContain("code: 50035");
    expect(text).toContain("status: 400");
  });

  it("truncates very long messages within discord limit", () => {
    const error = new Error("x".repeat(5000));
    error.stack = `Error: ${"x".repeat(5000)}\n    at foo`;
    const text = formatErrorForDiscord("process.uncaughtException", error);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("truncated");
  });
});

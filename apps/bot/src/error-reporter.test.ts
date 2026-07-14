import { afterEach, describe, expect, it } from "vitest";

import {
  buildDiscordLogEmbed,
  buildErrorLogEmbed,
  buildLifecycleLogEmbed,
  getErrorChannelId,
} from "./error-reporter.js";

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

describe("buildDiscordLogEmbed", () => {
  it("uses a consistent embed structure", () => {
    const embed = buildDiscordLogEmbed("test.event", {
      time: "2026-07-14T12:00:00.000Z",
      source: "test.event",
      guildId: "g1",
    });
    const data = embed.toJSON();

    expect(data.title).toBe("test.event");
    expect(data.timestamp).toBe("2026-07-14T12:00:00.000Z");
    expect(data.fields).toHaveLength(1);
    expect(data.fields?.[0]?.name).toBe("Details");
    expect(data.fields?.[0]?.value).toContain("```yaml");
    expect(data.fields?.[0]?.value).toContain("guildId: g1");
  });
});

describe("buildErrorLogEmbed", () => {
  it("adds message and stack fields", () => {
    const error = new Error("boom");
    const embed = buildErrorLogEmbed("interaction.failed", error, { guildId: "g1" });
    const data = embed.toJSON();

    expect(data.title).toBe("interaction.failed");
    expect(data.color).toBe(0xed4245);
    expect(data.fields?.map((field) => field.name)).toEqual(["Details", "Message", "Stack"]);
    expect(data.fields?.[0]?.value).toContain("guildId: g1");
    expect(data.fields?.[0]?.value).toContain("type: Error");
    expect(data.fields?.[1]?.value).toContain("boom");
    expect(data.fields?.[2]?.value).toContain("Error: boom");
  });

  it("includes discord api code in details when present", () => {
    const error = Object.assign(new Error("Invalid Form Body"), { code: 50_035, status: 400 });
    const embed = buildErrorLogEmbed("commands.register.failed", error);
    const details = embed.toJSON().fields?.[0]?.value ?? "";
    expect(details).toContain("code: 50035");
    expect(details).toContain("status: 400");
  });

  it("truncates very long stack fields", () => {
    const error = new Error("x".repeat(5000));
    error.stack = `Error: ${"x".repeat(5000)}\n    at foo`;
    const embed = buildErrorLogEmbed("process.uncaughtException", error);
    const stackField = embed.toJSON().fields?.find((field) => field.name === "Stack");
    expect(stackField?.value?.length).toBeLessThanOrEqual(1024);
    expect(stackField?.value).toContain("truncated");
  });
});

describe("buildLifecycleLogEmbed", () => {
  it("uses details only for lifecycle events", () => {
    const embed = buildLifecycleLogEmbed("bot.started", {
      tag: "Grimkeeper#1234",
      botMode: "minimal",
      commandsRegistered: true,
    });
    const data = embed.toJSON();

    expect(data.title).toBe("bot.started");
    expect(data.color).toBe(0x57f287);
    expect(data.fields).toHaveLength(1);
    expect(data.fields?.[0]?.name).toBe("Details");
    expect(data.fields?.[0]?.value).toContain("tag: Grimkeeper#1234");
    expect(data.fields?.[0]?.value).toContain("commandsRegistered: true");
  });
});

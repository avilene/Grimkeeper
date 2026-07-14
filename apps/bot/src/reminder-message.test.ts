import { describe, expect, it } from "vitest";

import {
  buildReminderFireContent,
  discordTimestamp,
  formatReminderText,
  parseReminderEmoji,
} from "./reminder-message.js";

describe("discordTimestamp", () => {
  it("formats relative and absolute timestamps", () => {
    const date = new Date("2026-07-14T16:00:00Z");
    expect(discordTimestamp(date, "R")).toBe(`<t:${Math.floor(date.getTime() / 1000)}:R>`);
    expect(discordTimestamp(date, "t")).toBe(`<t:${Math.floor(date.getTime() / 1000)}:t>`);
  });
});

describe("parseReminderEmoji", () => {
  it("accepts unicode and custom emoji", () => {
    expect(parseReminderEmoji("🔔")).toBe("🔔");
    expect(parseReminderEmoji("<:bell:123>")).toBe("<:bell:123>");
    expect(parseReminderEmoji("<a:party:456>")).toBe("<a:party:456>");
  });

  it("rejects empty and invalid input", () => {
    expect(parseReminderEmoji(undefined)).toBeNull();
    expect(parseReminderEmoji("")).toBeNull();
    expect(parseReminderEmoji("hello")).toBeNull();
    expect(parseReminderEmoji(":bell:")).toBeNull();
  });
});

describe("formatReminderText", () => {
  it("prefixes message with emoji when provided", () => {
    expect(formatReminderText("noms close", "🔔")).toBe("🔔 noms close");
    expect(formatReminderText("noms close")).toBe("noms close");
  });
});

describe("buildReminderFireContent", () => {
  it("includes player ping and scheduled time", () => {
    const fireAt = new Date("2026-07-14T16:00:00Z");
    const content = buildReminderFireContent("<@&123>", "noms close", fireAt, "🔔");
    expect(content).toContain("<@&123>");
    expect(content).toContain("🔔 noms close");
    expect(content).toContain(`<t:${Math.floor(fireAt.getTime() / 1000)}:t>`);
  });

  it("omits ping and emoji when unavailable", () => {
    const fireAt = new Date("2026-07-14T16:00:00Z");
    expect(buildReminderFireContent(null, "noms close", fireAt)).toBe(
      `noms close (<t:${Math.floor(fireAt.getTime() / 1000)}:t>)`,
    );
  });
});

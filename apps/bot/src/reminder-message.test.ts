import { describe, expect, it } from "vitest";

import {
  buildReminderFireContent,
  discordTimestamp,
  encodePingRoleIds,
  formatFiredReminderBody,
  formatPingRoleMentions,
  formatReminderText,
  parsePingRolesFromString,
  parseReminderEmoji,
  reminderEndAt,
  resolvePingRoleIds,
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

describe("reminderEndAt", () => {
  it("prefers series end for batch reminders", () => {
    const fireAt = new Date("2026-07-14T08:20:00Z");
    const seriesEndAt = new Date("2026-07-14T08:40:00Z");
    expect(reminderEndAt(fireAt, seriesEndAt)).toBe(seriesEndAt);
  });
});

describe("formatFiredReminderBody", () => {
  it("appends a Discord relative timestamp for the max end time", () => {
    const fireAt = new Date("2026-07-14T08:20:00Z");
    const seriesEndAt = new Date("2026-07-14T08:40:00Z");
    const content = formatFiredReminderBody("Noms and whispers close", fireAt, null, seriesEndAt);
    expect(content).toBe(
      `Noms and whispers close ${discordTimestamp(seriesEndAt, "R")}`,
    );
  });
});

describe("buildReminderFireContent", () => {
  it("includes player ping and relative timestamp", () => {
    const fireAt = new Date("2026-07-14T08:20:00Z");
    const seriesEndAt = new Date("2026-07-14T08:40:00Z");
    const content = buildReminderFireContent(
      "<@&123>",
      "Noms and whispers close",
      fireAt,
      "🔔",
      seriesEndAt,
    );
    expect(content).toBe(
      `<@&123> 🔔 Noms and whispers close ${discordTimestamp(seriesEndAt, "R")}`,
    );
  });

  it("uses fireAt when there is no series end", () => {
    const fireAt = new Date("2026-07-14T08:40:00Z");
    expect(buildReminderFireContent(null, "Noms and whispers close", fireAt)).toBe(
      `Noms and whispers close ${discordTimestamp(fireAt, "R")}`,
    );
  });
});

describe("parsePingRolesFromString", () => {
  const roleA = "123456789012345678";
  const roleB = "987654321098765432";

  it("parses role mentions and raw IDs", () => {
    expect(parsePingRolesFromString(`<@&${roleA}> <@&${roleB}>`)).toEqual([roleA, roleB]);
    expect(parsePingRolesFromString(`${roleA},${roleB}`)).toEqual([roleA, roleB]);
  });

  it("deduplicates repeated IDs", () => {
    expect(parsePingRolesFromString(`<@&${roleA}> ${roleA}`)).toEqual([roleA]);
  });
});

describe("resolvePingRoleIds", () => {
  const roleB = "987654321098765432";
  const roleC = "111111111111111111";

  it("parses string input and uses fallback", () => {
    expect(resolvePingRoleIds(`<@&${roleB}>`, roleC)).toEqual([roleB]);
    expect(resolvePingRoleIds(undefined, roleC)).toEqual([roleC]);
    expect(resolvePingRoleIds(undefined, null)).toEqual([]);
  });
});

describe("encodePingRoleIds and formatPingRoleMentions", () => {
  it("round-trips multiple role IDs", () => {
    const encoded = encodePingRoleIds(["123456789012345678", "987654321098765432"]);
    expect(encoded).toBe("123456789012345678,987654321098765432");
    expect(formatPingRoleMentions(encoded)).toBe(
      "<@&123456789012345678> <@&987654321098765432>",
    );
  });

  it("formats a single stored role ID", () => {
    expect(formatPingRoleMentions("123456789012345678")).toBe("<@&123456789012345678>");
  });
});

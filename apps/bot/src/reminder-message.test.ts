import { describe, expect, it } from "vitest";

import { buildReminderFireContent, discordTimestamp } from "./reminder-message.js";

describe("discordTimestamp", () => {
  it("formats relative and absolute timestamps", () => {
    const date = new Date("2026-07-14T16:00:00Z");
    expect(discordTimestamp(date, "R")).toBe(`<t:${Math.floor(date.getTime() / 1000)}:R>`);
    expect(discordTimestamp(date, "t")).toBe(`<t:${Math.floor(date.getTime() / 1000)}:t>`);
  });
});

describe("buildReminderFireContent", () => {
  it("includes player ping and scheduled time", () => {
    const fireAt = new Date("2026-07-14T16:00:00Z");
    const content = buildReminderFireContent("<@&123>", "noms close", fireAt);
    expect(content).toContain("<@&123>");
    expect(content).toContain("⏰ noms close");
    expect(content).toContain(`<t:${Math.floor(fireAt.getTime() / 1000)}:t>`);
  });

  it("omits ping when unavailable", () => {
    const fireAt = new Date("2026-07-14T16:00:00Z");
    expect(buildReminderFireContent(null, "noms close", fireAt)).toBe(
      `⏰ noms close (<t:${Math.floor(fireAt.getTime() / 1000)}:t>)`,
    );
  });
});

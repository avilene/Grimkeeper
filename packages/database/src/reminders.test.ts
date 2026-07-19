import { describe, expect, it } from "vitest";

import {
  normalizeReminderMessage,
  reminderDuplicateWindow,
} from "./reminders.js";

describe("normalizeReminderMessage", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeReminderMessage("  Whispers   Close ")).toBe("whispers close");
  });
});

describe("reminderDuplicateWindow", () => {
  it("spans ±90 seconds around fireAt", () => {
    const fireAt = new Date("2026-07-19T08:26:00Z");
    const { start, end } = reminderDuplicateWindow(fireAt);
    expect(end.getTime() - start.getTime()).toBe(180_000);
    expect(fireAt.getTime() - start.getTime()).toBe(90_000);
  });
});

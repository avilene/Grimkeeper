import { describe, expect, it } from "vitest";

import { batchReminderSourceKey } from "@grimkeeper/database";

import { reminderSendDedupeKey } from "./reminder-scheduler.js";

describe("batchReminderSourceKey", () => {
  it("is stable for the same hour offset and message", () => {
    expect(batchReminderSourceKey("guild", "channel", 4, "Noms close")).toBe(
      batchReminderSourceKey("guild", "channel", 4, "  noms   close "),
    );
  });

  it("does not change when wall-clock fire time differs for the same offset", () => {
    // Previously keyed by fireAt.getTime(), so parallel set-reminders stacked rows.
    expect(batchReminderSourceKey("guild", "channel", 4, "Noms close")).toBe(
      "set:guild:channel:h4:noms close",
    );
  });

  it("differs across hour offsets", () => {
    const a = batchReminderSourceKey("guild", "channel", 4, "Noms close");
    const b = batchReminderSourceKey("guild", "channel", 8, "Noms close");
    expect(a).not.toBe(b);
  });
});

describe("reminderSendDedupeKey", () => {
  it("collapses same channel/message within the duplicate window", () => {
    const key = reminderSendDedupeKey({
      channelId: "c1",
      message: "Noms close",
      fireAt: new Date("2026-07-17T10:00:30Z"),
    });
    expect(
      reminderSendDedupeKey({
        channelId: "c1",
        message: " noms close ",
        fireAt: new Date("2026-07-17T10:01:00Z"),
      }),
    ).toBe(key);
  });

  it("keeps far-apart fire times separate", () => {
    const early = reminderSendDedupeKey({
      channelId: "c1",
      message: "Noms close",
      fireAt: new Date("2026-07-17T10:00:00Z"),
    });
    const later = reminderSendDedupeKey({
      channelId: "c1",
      message: "Noms close",
      fireAt: new Date("2026-07-17T14:00:00Z"),
    });
    expect(early).not.toBe(later);
  });
});

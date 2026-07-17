import { describe, expect, it } from "vitest";

import { batchReminderSourceKey } from "@grimkeeper/database";

import { reminderSendDedupeKey } from "./reminder-scheduler.js";

describe("batchReminderSourceKey", () => {
  it("is stable for the same schedule slot", () => {
    const fireAt = new Date("2026-07-17T10:00:00Z");
    expect(
      batchReminderSourceKey("guild", "channel", fireAt, "Noms close"),
    ).toBe(batchReminderSourceKey("guild", "channel", fireAt, "  noms   close "));
  });

  it("differs across fire times", () => {
    const a = batchReminderSourceKey(
      "guild",
      "channel",
      new Date("2026-07-17T10:00:00Z"),
      "Noms close",
    );
    const b = batchReminderSourceKey(
      "guild",
      "channel",
      new Date("2026-07-17T14:00:00Z"),
      "Noms close",
    );
    expect(a).not.toBe(b);
  });
});

describe("reminderSendDedupeKey", () => {
  it("collapses same channel/message/minute", () => {
    const key = reminderSendDedupeKey({
      channelId: "c1",
      message: "Noms close",
      fireAt: new Date("2026-07-17T10:00:30Z"),
    });
    expect(
      reminderSendDedupeKey({
        channelId: "c1",
        message: " noms close ",
        fireAt: new Date("2026-07-17T10:00:55Z"),
      }),
    ).toBe(key);
  });

  it("keeps distinct fire minutes separate", () => {
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

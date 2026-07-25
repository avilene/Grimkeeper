import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    gameReminder: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./client.js";
import {
  createReminder,
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

describe("createReminder sourceKey upsert", () => {
  beforeEach(() => {
    vi.mocked(prisma.gameReminder.findUnique).mockReset();
    vi.mocked(prisma.gameReminder.update).mockReset();
    vi.mocked(prisma.gameReminder.create).mockReset();
  });

  it("updates fireAt for an existing unfired sourceKey (deadline reschedule)", async () => {
    const existing = {
      id: "rem-1",
      sourceKey: "vote-deadline:nom-1",
      fired: false,
      fireAt: new Date("2026-07-02T12:00:00.000Z"),
    };
    const nextFireAt = new Date("2026-07-02T18:00:00.000Z");
    vi.mocked(prisma.gameReminder.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.gameReminder.update).mockResolvedValue({
      ...existing,
      fireAt: nextFireAt,
    } as never);

    await createReminder({
      gameId: "game-1",
      guildId: "guild-1",
      channelId: "kib-1",
      message: "Deadline hit",
      fireAt: nextFireAt,
      createdBy: "system:vote-deadline",
      sourceKey: "vote-deadline:nom-1",
    });

    expect(prisma.gameReminder.update).toHaveBeenCalledWith({
      where: { id: "rem-1" },
      data: expect.objectContaining({
        fireAt: nextFireAt,
        fired: false,
        sourceKey: "vote-deadline:nom-1",
      }),
    });
    expect(prisma.gameReminder.create).not.toHaveBeenCalled();
  });
});

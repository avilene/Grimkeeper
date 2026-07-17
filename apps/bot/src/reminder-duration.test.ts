import { describe, expect, it } from "vitest";

import {
  formatReminderDuration,
  formatHoursFromNow,
  formatReminderFireIn,
  formatHourOffsetCompact,
  parseReminderDuration,
  parseReminderHours,
  parseReminderHourOffset,
} from "./reminder-duration.js";

describe("parseReminderDuration", () => {
  it("parses minutes", () => {
    expect(parseReminderDuration("5m")).toBe(5);
    expect(parseReminderDuration("10")).toBe(10);
  });

  it("parses hours", () => {
    expect(parseReminderDuration("1h")).toBe(60);
    expect(parseReminderDuration("2 hours")).toBe(120);
  });

  it("rejects invalid durations", () => {
    expect(parseReminderDuration("0m")).toBeNull();
    expect(parseReminderDuration("abc")).toBeNull();
    expect(parseReminderDuration("25h")).toBeNull();
  });
});

describe("formatReminderDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatReminderDuration(5)).toBe("5 minutes");
    expect(formatReminderDuration(1)).toBe("1 minute");
    expect(formatReminderDuration(60)).toBe("1 hour");
    expect(formatReminderDuration(120)).toBe("2 hours");
  });
});

describe("formatHoursFromNow", () => {
  it("formats hour offsets as readable relative times", () => {
    expect(formatHoursFromNow(16)).toBe("in 16 hours");
    expect(formatHoursFromNow(0.5)).toBe("in 30 minutes");
    expect(formatHoursFromNow(1)).toBe("in 1 hour");
  });
});

describe("formatHourOffsetCompact", () => {
  it("formats compact offsets", () => {
    expect(formatHourOffsetCompact(1 / 60)).toBe("1m");
    expect(formatHourOffsetCompact(0.5)).toBe("30m");
    expect(formatHourOffsetCompact(1)).toBe("1h");
    expect(formatHourOffsetCompact(1.5)).toBe("1h30m");
  });
});

describe("formatReminderFireIn", () => {
  it("formats future fire times relative to now", () => {
    const now = Date.parse("2026-07-14T08:00:00Z");
    const fireAt = new Date("2026-07-14T16:00:00Z");
    expect(formatReminderFireIn(fireAt, now)).toBe("in 8 hours");
  });

  it("returns now for past or immediate times", () => {
    const now = Date.parse("2026-07-14T16:00:00Z");
    expect(formatReminderFireIn(new Date("2026-07-14T16:00:00Z"), now)).toBe("now");
  });
});

describe("parseReminderHourOffset", () => {
  it("parses human durations into hours", () => {
    expect(parseReminderHourOffset("1m")).toBeCloseTo(1 / 60);
    expect(parseReminderHourOffset("10m")).toBeCloseTo(10 / 60);
    expect(parseReminderHourOffset("30m")).toBe(0.5);
    expect(parseReminderHourOffset("1h")).toBe(1);
    expect(parseReminderHourOffset("1.5h")).toBe(1.5);
  });

  it("keeps bare numbers as hours", () => {
    expect(parseReminderHourOffset("4")).toBe(4);
    expect(parseReminderHourOffset("0.5")).toBe(0.5);
  });
});

describe("parseReminderHours", () => {
  it("parses space-separated hour offsets", () => {
    expect(parseReminderHours("4 8 12")).toEqual([4, 8, 12]);
    expect(parseReminderHours("  4   8  12 ")).toEqual([4, 8, 12]);
  });

  it("parses fractional hour offsets", () => {
    expect(parseReminderHours("0.5 1 2")).toEqual([0.5, 1, 2]);
    expect(parseReminderHours("1.5 4")).toEqual([1.5, 4]);
  });

  it("parses human offsets like 1h 30m 10m", () => {
    expect(parseReminderHours("1m 10m 30m 1h")).toEqual([1 / 60, 10 / 60, 0.5, 1]);
    expect(parseReminderHours("30m 1h 4 8")).toEqual([0.5, 1, 4, 8]);
    expect(parseReminderHours("0.5 30m")).toEqual([0.5]);
  });

  it("dedupes and sorts", () => {
    expect(parseReminderHours("12 4 8 4 12")).toEqual([4, 8, 12]);
    expect(parseReminderHours("0.5 1 0.5")).toEqual([0.5, 1]);
  });

  it("rejects invalid input", () => {
    expect(parseReminderHours("")).toBeNull();
    expect(parseReminderHours("0 4")).toBeNull();
    expect(parseReminderHours("25")).toBeNull();
    expect(parseReminderHours("25h")).toBeNull();
    expect(parseReminderHours("0m")).toBeNull();
    expect(parseReminderHours("abc")).toBeNull();
  });
});

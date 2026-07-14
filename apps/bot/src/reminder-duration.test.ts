import { describe, expect, it } from "vitest";

import { formatReminderDuration, parseReminderDuration, parseReminderHours } from "./reminder-duration.js";

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

describe("parseReminderHours", () => {
  it("parses space-separated hour offsets", () => {
    expect(parseReminderHours("4 8 12")).toEqual([4, 8, 12]);
    expect(parseReminderHours("  4   8  12 ")).toEqual([4, 8, 12]);
  });

  it("dedupes and sorts", () => {
    expect(parseReminderHours("12 4 8 4 12")).toEqual([4, 8, 12]);
  });

  it("rejects invalid input", () => {
    expect(parseReminderHours("")).toBeNull();
    expect(parseReminderHours("0 4")).toBeNull();
    expect(parseReminderHours("25")).toBeNull();
    expect(parseReminderHours("4h")).toBeNull();
    expect(parseReminderHours("abc")).toBeNull();
  });
});

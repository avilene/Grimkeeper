const REMINDER_DURATION = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)?$/i;

export function parseReminderDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(REMINDER_DURATION);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;

  const unit = match[2]?.toLowerCase() ?? "m";
  if (unit.startsWith("h")) {
    if (amount > 24) return null;
    return amount * 60;
  }

  if (amount > 24 * 60) return null;
  return amount;
}

const MAX_REMINDER_HOURS_BATCH = 25;
const MIN_REMINDER_HOURS = 0.5;
const MAX_REMINDER_HOURS = 24;
const HOUR_OFFSET = /^\d+(\.\d+)?$/;

export function parseReminderHours(input: string): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const hours: number[] = [];

  for (const part of parts) {
    if (!HOUR_OFFSET.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value) || value < MIN_REMINDER_HOURS || value > MAX_REMINDER_HOURS) return null;
    hours.push(value);
  }

  if (hours.length === 0 || hours.length > MAX_REMINDER_HOURS_BATCH) return null;

  return [...new Set(hours)].sort((a, b) => a - b);
}

export function formatReminderDuration(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

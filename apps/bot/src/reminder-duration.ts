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
/** Minimum offset: 1 minute (also allows legacy `0.5` hour). */
const MIN_REMINDER_HOURS = 1 / 60;
const MAX_REMINDER_HOURS = 24;
const BARE_HOUR_OFFSET = /^\d+(\.\d+)?$/;
/** Human offsets for set-reminders tokens: `30m`, `1h`, `1.5h` (unit required). */
const HUMAN_HOUR_OFFSET =
  /^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/i;

/** Parse one set-reminders token into hours from now. Bare numbers stay hours (`4` = 4h). */
export function parseReminderHourOffset(part: string): number | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  const human = trimmed.match(HUMAN_HOUR_OFFSET);
  if (human) {
    const amount = Number(human[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = human[2].toLowerCase();
    const hours = unit.startsWith("h") ? amount : amount / 60;
    if (hours < MIN_REMINDER_HOURS || hours > MAX_REMINDER_HOURS) return null;
    return hours;
  }

  // Legacy: bare decimals are hours (`0.5` = 30m, `4` = 4h).
  if (!BARE_HOUR_OFFSET.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < MIN_REMINDER_HOURS || value > MAX_REMINDER_HOURS) {
    return null;
  }
  return value;
}

export function parseReminderHours(input: string): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const hours: number[] = [];

  for (const part of parts) {
    const value = parseReminderHourOffset(part);
    if (value == null) return null;
    hours.push(value);
  }

  if (hours.length === 0 || hours.length > MAX_REMINDER_HOURS_BATCH) return null;

  // Round to nearest second so 30m and 0.5 dedupe cleanly.
  const normalized = hours.map((hour) => Math.round(hour * 3600) / 3600);
  return [...new Set(normalized)].sort((a, b) => a - b);
}

export function formatReminderDuration(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Compact offset label for logs/UI (`30m`, `1h`, `1h30m`). */
export function formatHourOffsetCompact(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m}m`;
}

export function formatHoursFromNow(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `in ${formatReminderDuration(minutes)}`;
}

export function formatReminderFireIn(fireAt: Date, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((fireAt.getTime() - now) / 60_000));
  if (minutes === 0) return "now";
  return `in ${formatReminderDuration(minutes)}`;
}

export function parseTimezoneOffsetMinutes(value: FormDataEntryValue | null): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : 0;
}

function parseLocalDateTimeParts(raw: string, label: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) throw new Error(`Invalid ${label.toLowerCase()}.`);

  const [, year, month, day, hour, minute, second] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? "0"),
  };
}

/**
 * Interpret a `datetime-local` form value in the browser's local timezone,
 * then convert it to an absolute UTC timestamp for storage.
 */
export function parseLocalDateTime(
  value: FormDataEntryValue | null,
  timezoneOffsetMinutes: number,
  label: string,
): Date {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is required.`);
  const parts = parseLocalDateTimeParts(raw, label);
  const utcMillis =
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    ) +
    timezoneOffsetMinutes * 60_000;
  const date = new Date(utcMillis);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label.toLowerCase()}.`);
  return date;
}

export function parseOptionalLocalDateTime(
  value: FormDataEntryValue | null,
  timezoneOffsetMinutes: number,
  label: string,
): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return parseLocalDateTime(raw, timezoneOffsetMinutes, label);
}

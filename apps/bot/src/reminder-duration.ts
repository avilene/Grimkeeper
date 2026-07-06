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

export function formatReminderDuration(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

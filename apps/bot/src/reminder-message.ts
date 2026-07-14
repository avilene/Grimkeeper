export function discordTimestamp(date: Date, style: "R" | "F" | "t" = "R"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

const CUSTOM_EMOJI = /^<a?:[a-zA-Z0-9_]+:\d+>$/u;
const UNICODE_EMOJI =
  /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u;

export function parseReminderEmoji(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (CUSTOM_EMOJI.test(trimmed) || UNICODE_EMOJI.test(trimmed)) return trimmed;
  return null;
}

export function formatReminderText(message: string, emoji?: string | null): string {
  const prefix = emoji ? `${emoji} ` : "";
  return `${prefix}${message.trim()}`;
}

/** Series end time, or this reminder's fireAt when solo. */
export function reminderEndAt(fireAt: Date, seriesEndAt?: Date | null): Date {
  return seriesEndAt ?? fireAt;
}

export function formatFiredReminderBody(
  message: string,
  fireAt: Date,
  emoji?: string | null,
  seriesEndAt?: Date | null,
): string {
  const base = formatReminderText(message, emoji);
  const endAt = reminderEndAt(fireAt, seriesEndAt);
  return `${base} ${discordTimestamp(endAt, "R")}`;
}

export function buildReminderFireContent(
  playerPing: string | null,
  message: string,
  fireAt: Date,
  emoji?: string | null,
  seriesEndAt?: Date | null,
): string {
  const body = formatFiredReminderBody(message, fireAt, emoji, seriesEndAt);
  return playerPing ? `${playerPing} ${body}` : body;
}

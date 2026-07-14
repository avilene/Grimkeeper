import { formatReminderFireIn } from "./reminder-duration.js";

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

export function formatSeriesEndNote(
  fireAt: Date,
  seriesEndAt: Date | null | undefined,
  now = Date.now(),
): string {
  if (!seriesEndAt || seriesEndAt.getTime() <= fireAt.getTime()) return "";
  return ` · Final reminder ${formatReminderFireIn(seriesEndAt, now)} (${discordTimestamp(seriesEndAt, "F")})`;
}

export function buildReminderFireContent(
  playerPing: string | null,
  message: string,
  fireAt: Date,
  emoji?: string | null,
  seriesEndAt?: Date | null,
): string {
  const seriesNote = formatSeriesEndNote(fireAt, seriesEndAt);
  const when = seriesNote ? "" : ` (${discordTimestamp(fireAt, "t")})`;
  const body = `${formatReminderText(message, emoji)}${when}${seriesNote}`;
  return playerPing ? `${playerPing} ${body}` : body;
}

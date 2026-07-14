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

const ROLE_MENTION_OR_ID = /<@&(\d{17,20})>|(\d{17,20})/g;

/** Parse role mentions or snowflake IDs from a slash-command string. */
export function parsePingRolesFromString(input: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of input.matchAll(ROLE_MENTION_OR_ID)) {
    const id = match[1] ?? match[2];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function resolvePingRoleIds(
  singleRoleId: string | undefined,
  rolesInput: string | undefined,
  fallbackRoleId: string | null,
): string[] {
  const ids = new Set<string>();
  if (singleRoleId) ids.add(singleRoleId);
  if (rolesInput?.trim()) {
    for (const id of parsePingRolesFromString(rolesInput)) ids.add(id);
  }
  if (ids.size === 0 && fallbackRoleId) ids.add(fallbackRoleId);
  return [...ids];
}

export function encodePingRoleIds(roleIds: string[]): string | null {
  return roleIds.length > 0 ? roleIds.join(",") : null;
}

export function formatPingRoleMentions(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const mentions = stored
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => `<@&${id}>`);
  return mentions.length > 0 ? mentions.join(" ") : null;
}

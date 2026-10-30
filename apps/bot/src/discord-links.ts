/**
 * Discord jump / channel links used in plain message content and stored reminders.
 */

const DISCORD_CHANNEL_URL_SRC =
  String.raw`(?:https:\/\/)?(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d+\/\d+(?:\/\d+)?`;

const DISCORD_CHANNEL_URL = new RegExp(DISCORD_CHANNEL_URL_SRC, "i");
const SUPPRESSED_DISCORD_CHANNEL_URL = new RegExp(
  String.raw`<\s*(${DISCORD_CHANNEL_URL_SRC})\s*>`,
  "gi",
);

/** Make text safe as a Discord `[label](url)` label (strips nested brackets/parens). */
export function sanitizeDiscordLinkLabel(text: string): string {
  const cleaned = text
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "link";
}

/**
 * Discord often fails to resolve masked links when the label contains emoji
 * (shows raw `[label](url)` instead of a hyperlink).
 */
export function stripDiscordLinkLabelEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F|\u200D/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Masked markdown jump link for plain bot message content. */
export function formatMaskedDiscordLink(label: string, url: string): string {
  const safeLabel =
    stripDiscordLinkLabelEmoji(sanitizeDiscordLinkLabel(label)) || "link";
  return `[${safeLabel}](${url.trim()})`;
}

/**
 * Upgrade legacy suppressed jump links so Discord can render them.
 * `<https://discord.com/channels/...>` → bare URL (so `(<url>)` becomes `(url)`).
 */
export function unwrapSuppressedDiscordChannelLinks(text: string): string {
  return text.replace(SUPPRESSED_DISCORD_CHANNEL_URL, "$1");
}

/** True when the text already contains a Discord channel/message jump URL. */
export function containsDiscordChannelUrl(text: string): boolean {
  return DISCORD_CHANNEL_URL.test(text);
}

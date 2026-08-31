import type { EmbedBuilder } from "discord.js";

/** Shown instead of Discord's fixed "Bot is thinking…" (via reply + editReply). */
export const INTERACTION_PENDING_CONTENT = "Working…";

/** Discord message `content` max length (API `BASE_TYPE_MAX_LENGTH`). */
export const DISCORD_CONTENT_LIMIT = 2000;

/**
 * Split a message so each chunk is at most `maxLength` characters.
 * Breaks on newlines so archive dry-run lists stay readable.
 */
export function splitDiscordContent(
  content: string,
  maxLength = DISCORD_CONTENT_LIMIT,
): string[] {
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current);
    current = "";
  };

  for (const line of content.split("\n")) {
    if (line.length > maxLength) {
      flush();
      for (let offset = 0; offset < line.length; offset += maxLength) {
        chunks.push(line.slice(offset, offset + maxLength));
      }
      continue;
    }
    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length > maxLength) {
      flush();
      current = line;
    } else {
      current = next;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [""];
}

export type InteractionEditPayload = {
  content?: string | null;
  embeds?: EmbedBuilder[];
  flags?: number;
};

function discordErrorCode(error: unknown): unknown {
  if (error === null || typeof error !== "object" || !("code" in error)) return undefined;
  return error.code;
}

/** Clear placeholder text when a final reply is embeds-only. */
export function toEditReplyPayload(payload: InteractionEditPayload): InteractionEditPayload {
  if (payload.content === undefined && payload.embeds && payload.embeds.length > 0) {
    return { ...payload, content: null };
  }
  return payload;
}

/** Interaction expired / already handled elsewhere (often a second bot replica). */
export function isUnknownInteractionError(error: unknown): boolean {
  return discordErrorCode(error) === 10062;
}

export function isRecoverableInteractionResponseError(error: unknown): boolean {
  const code = discordErrorCode(error);
  // 40060: already acknowledged in this process. 10062: unknown/expired — often another replica
  // already replied; further reply/edit/followUp attempts are pointless.
  return code === 40060 || code === 10062 || code === "InteractionNotReplied";
}

/** @deprecated Use isRecoverableInteractionResponseError */
export function isInteractionAlreadyAcknowledged(error: unknown): boolean {
  return isRecoverableInteractionResponseError(error);
}

/**
 * Ack failures that are non-fatal (don't crash the handler / don't retry forever).
 * Callers decide whether to surface them: fast 10062/40060 is usually a twin
 * gateway consumer; late 10062 usually means we missed Discord's ~3s ack window.
 */
export function isBenignInteractionAckError(error: unknown): boolean {
  return isRecoverableInteractionResponseError(error);
}

/**
 * Discord's interaction ack window is ~3s. A 10062/40060 with age well under that
 * is almost always a second gateway consumer racing the ack (deploy overlap /
 * accidental scale>1), not a slow handler — skip error-channel spam.
 */
export const UNKNOWN_INTERACTION_REPORT_MIN_AGE_MS = 2_500;

/** Age of an interaction since Discord created it (ms). */
export function interactionCreatedAgeMs(
  interaction: { createdTimestamp: number },
  now = Date.now(),
): number {
  return now - interaction.createdTimestamp;
}

/** True when a benign 10062/40060 is worth error-channel noise (likely missed deadline). */
export function shouldReportUnknownInteractionAck(ageMs: number): boolean {
  return ageMs > UNKNOWN_INTERACTION_REPORT_MIN_AGE_MS;
}

export async function withAcknowledgedFallback(
  attempts: Array<() => Promise<unknown>>,
): Promise<void> {
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      if (!isRecoverableInteractionResponseError(error)) {
        throw error;
      }
      // Unknown interaction: don't keep trying followUp/reply on a dead token.
      if (isUnknownInteractionError(error)) {
        return;
      }
    }
  }
}

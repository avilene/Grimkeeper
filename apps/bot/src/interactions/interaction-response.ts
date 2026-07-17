import type { EmbedBuilder } from "discord.js";

/** Shown instead of Discord's fixed "Bot is thinking…" (via reply + editReply). */
export const INTERACTION_PENDING_CONTENT = "Working…";

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
 * Ack failures that should not page the error channel (duplicate bots, races, expired tokens).
 */
export function isBenignInteractionAckError(error: unknown): boolean {
  return isRecoverableInteractionResponseError(error);
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

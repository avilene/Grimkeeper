import type { EmbedBuilder } from "discord.js";

/** Shown instead of Discord's fixed "Bot is thinking…" (via reply + editReply). */
export const INTERACTION_PENDING_CONTENT = "Working…";

export type InteractionEditPayload = {
  content?: string | null;
  embeds?: EmbedBuilder[];
  flags?: number;
};

/** Clear placeholder text when a final reply is embeds-only. */
export function toEditReplyPayload(payload: InteractionEditPayload): InteractionEditPayload {
  if (payload.content === undefined && payload.embeds && payload.embeds.length > 0) {
    return { ...payload, content: null };
  }
  return payload;
}

export function isRecoverableInteractionResponseError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  const code = error.code;
  return code === 40060 || code === "InteractionNotReplied";
}

/** @deprecated Use isRecoverableInteractionResponseError */
export function isInteractionAlreadyAcknowledged(error: unknown): boolean {
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
    }
  }
}

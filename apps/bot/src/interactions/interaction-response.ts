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
  for (let i = 0; i < attempts.length; i++) {
    try {
      await attempts[i]();
      return;
    } catch (error) {
      if (!isRecoverableInteractionResponseError(error) || i === attempts.length - 1) {
        throw error;
      }
    }
  }
}

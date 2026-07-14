export function isInteractionAlreadyAcknowledged(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 40060
  );
}

export async function withAcknowledgedFallback(
  attempts: Array<() => Promise<unknown>>,
): Promise<void> {
  for (let i = 0; i < attempts.length; i++) {
    try {
      await attempts[i]();
      return;
    } catch (error) {
      if (!isInteractionAlreadyAcknowledged(error) || i === attempts.length - 1) {
        throw error;
      }
    }
  }
}

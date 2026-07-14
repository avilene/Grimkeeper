const SEEN_TTL_MS = 15 * 60_000;
const seenInteractionIds = new Map<string, number>();

function pruneSeenInteractions(now = Date.now()): void {
  for (const [id, seenAt] of seenInteractionIds) {
    if (now - seenAt > SEEN_TTL_MS) {
      seenInteractionIds.delete(id);
    }
  }
}

/** Synchronous guard — call before any await in interactionCreate. */
export function tryMarkInteractionOnce(id: string): boolean {
  pruneSeenInteractions();
  if (seenInteractionIds.has(id)) return false;
  seenInteractionIds.set(id, Date.now());
  return true;
}

export function resetSeenInteractionsForTests(): void {
  seenInteractionIds.clear();
}

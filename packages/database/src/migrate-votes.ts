import { prisma } from "./client.js";

/**
 * Migrate Vote rows from the old two-column schema (choice + privateChoice) to the new
 * per-ballot schema (choice + isPrivate).
 *
 * Old schema: one row per (nominationId, voterId) with separate `choice` (public)
 *   and `privateChoice` (private) columns.
 * New schema: one row per (nominationId, voterId, isPrivate) with a single `choice` column
 *   and an `isPrivate` boolean.
 *
 * This migration reads the old columns via a raw SQL query and creates the missing private-ballot
 * rows while the database still has both the legacy private-vote columns and the new
 * `isPrivate` uniqueness constraint.
 *
 * Run against a transitional schema where `isPrivate` already exists but `privateChoice` and
 * `privateReason` have not been dropped yet. If the legacy columns are already gone this script
 * is a no-op.
 */
export async function migrateVotesToIsPrivate(): Promise<{ created: number }> {
  let oldRows: Array<{
    id: string;
    gameDayId: string;
    nominationId: string;
    voterId: string;
    privateChoice: string | null;
    privateReason: string | null;
  }>;
  try {
    // Use a raw query to read the old columns (they may not exist in the new Prisma client).
    oldRows = await prisma.$queryRaw<
      Array<{
        id: string;
        gameDayId: string;
        nominationId: string;
        voterId: string;
        privateChoice: string | null;
        privateReason: string | null;
      }>
    >`SELECT id, "gameDayId", "nominationId", "voterId", "privateChoice", "privateReason"
      FROM "Vote"
      WHERE "privateChoice" IS NOT NULL`;
  } catch (error) {
    if (isMissingLegacyVoteColumnError(error)) {
      return { created: 0 };
    }
    throw error;
  }

  let created = 0;
  for (const row of oldRows) {
    if (!row.privateChoice) continue;

    // Check if a private-ballot row already exists for this (nomination, voter).
    const existing = await prisma.vote.findUnique({
      where: {
        nominationId_voterId_isPrivate: {
          nominationId: row.nominationId,
          voterId: row.voterId,
          isPrivate: true,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.vote.create({
      data: {
        gameDayId: row.gameDayId,
        nominationId: row.nominationId,
        voterId: row.voterId,
        choice: row.privateChoice,
        reason: row.privateReason ?? null,
        isPrivate: true,
      },
    });
    created += 1;
  }

  return { created };
}

function isMissingLegacyVoteColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("privateChoice") ||
    error.message.includes("privateReason")
  ) && (
    error.message.includes("no such column") ||
    error.message.includes("does not exist")
  );
}

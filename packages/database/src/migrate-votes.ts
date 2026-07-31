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
 * rows before the old columns are dropped by `prisma db push`.
 *
 * Run AFTER running `prisma db push` with the new schema (which adds `isPrivate` and drops
 * `privateChoice`/`privateReason`). If old columns are already gone this script is a no-op.
 */
export async function migrateVotesToIsPrivate(): Promise<{ created: number }> {
  // Use a raw query to read the old columns (they may not exist in the new Prisma client).
  const oldRows = await prisma.$queryRaw<
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

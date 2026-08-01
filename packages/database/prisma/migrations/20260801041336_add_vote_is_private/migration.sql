-- AlterTable: add isPrivate column to Vote
ALTER TABLE "Vote" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex: remove old unique index (nominationId, voterId) if it exists
DROP INDEX IF EXISTS "Vote_nominationId_voterId_key";

-- CreateIndex: new unique index including isPrivate
CREATE UNIQUE INDEX IF NOT EXISTS "Vote_nominationId_voterId_isPrivate_key" ON "Vote"("nominationId", "voterId", "isPrivate");

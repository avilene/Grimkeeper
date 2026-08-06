-- CreateTable
CREATE TABLE "InterestPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scriptUrl" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "maxPlayers" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InterestSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterestSignup_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "InterestPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InterestPost_guildId_idx" ON "InterestPost"("guildId");

-- CreateIndex
CREATE INDEX "InterestPost_guildId_channelId_idx" ON "InterestPost"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "InterestPost_messageId_idx" ON "InterestPost"("messageId");

-- CreateIndex
CREATE INDEX "InterestPost_ownerId_idx" ON "InterestPost"("ownerId");

-- CreateIndex
CREATE INDEX "InterestSignup_interestId_idx" ON "InterestSignup"("interestId");

-- CreateIndex
CREATE INDEX "InterestSignup_userId_idx" ON "InterestSignup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestSignup_interestId_userId_key" ON "InterestSignup"("interestId", "userId");

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'lobby',
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "nightNumber" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "source" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "discordNomsRefreshRequestedAt" DATETIME,
    "discordKibNomsRepostRequestedAt" DATETIME,
    "discordPingMissingRequestedAt" DATETIME,
    "discordPingMissingNominationId" TEXT,
    "setupMode" TEXT,
    "buffetConfig" JSONB,
    "stRoleId" TEXT,
    "playerRoleId" TEXT,
    "kibRoleId" TEXT,
    "kibThreadId" TEXT,
    "logThreadId" TEXT,
    "votingThreadId" TEXT,
    "whisperDeclThreadId" TEXT,
    "claimsThreadId" TEXT,
    "rulesThreadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameWhisper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "neighbor" BOOLEAN NOT NULL DEFAULT false,
    "creatorDiscordId" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL DEFAULT '',
    "participantKey" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameWhisper_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "seat" INTEGER,
    "roleId" TEXT,
    "team" TEXT,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "ghostVoteUsed" BOOLEAN NOT NULL DEFAULT false,
    "stThreadId" TEXT,
    CONSTRAINT "Player_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "discordThreadId" TEXT,
    "nominationsOpen" BOOLEAN NOT NULL DEFAULT true,
    "voteVisibility" TEXT NOT NULL DEFAULT 'public',
    "executionUsed" BOOLEAN NOT NULL DEFAULT false,
    "nominationsPausedUntil" DATETIME,
    CONSTRAINT "GameDay_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Nomination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameDayId" TEXT NOT NULL,
    "nominatorId" TEXT NOT NULL,
    "nomineeId" TEXT NOT NULL,
    "accusation" TEXT NOT NULL,
    "defense" TEXT,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "voteDeadlineAt" DATETIME,
    CONSTRAINT "Nomination_gameDayId_fkey" FOREIGN KEY ("gameDayId") REFERENCES "GameDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameDayId" TEXT NOT NULL,
    "nominationId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "choice" TEXT,
    "reason" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Vote_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "Nomination" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Vote_gameDayId_fkey" FOREIGN KEY ("gameDayId") REFERENCES "GameDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "emoji" TEXT,
    "sourceKey" TEXT,
    "fireAt" DATETIME NOT NULL,
    "seriesEndAt" DATETIME,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "pingPlayers" BOOLEAN NOT NULL DEFAULT false,
    "pingRoleId" TEXT,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "GameReminder_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerAlias" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("guildId", "discordUserId")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StQueueBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "panelMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StQueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "scriptName" TEXT NOT NULL,
    "scriptLink" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "scriptImageUrls" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StQueueEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "StQueueBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StQueueMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StQueueMember_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StQueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "archiveCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Game_guildId_idx" ON "Game"("guildId");

-- CreateIndex
CREATE INDEX "Game_guildId_phase_idx" ON "Game"("guildId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "GameWhisper_threadId_key" ON "GameWhisper"("threadId");

-- CreateIndex
CREATE INDEX "GameWhisper_gameId_idx" ON "GameWhisper"("gameId");

-- CreateIndex
CREATE INDEX "GameWhisper_gameId_participantKey_idx" ON "GameWhisper"("gameId", "participantKey");

-- CreateIndex
CREATE INDEX "Player_gameId_idx" ON "Player"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_gameId_discordUserId_key" ON "Player"("gameId", "discordUserId");

-- CreateIndex
CREATE INDEX "GameDay_gameId_idx" ON "GameDay"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameDay_gameId_dayNumber_key" ON "GameDay"("gameId", "dayNumber");

-- CreateIndex
CREATE INDEX "Nomination_gameDayId_idx" ON "Nomination"("gameDayId");

-- CreateIndex
CREATE INDEX "Nomination_gameDayId_order_idx" ON "Nomination"("gameDayId", "order");

-- CreateIndex
CREATE INDEX "Vote_gameDayId_idx" ON "Vote"("gameDayId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_nominationId_voterId_isPrivate_key" ON "Vote"("nominationId", "voterId", "isPrivate");

-- CreateIndex
CREATE UNIQUE INDEX "GameReminder_sourceKey_key" ON "GameReminder"("sourceKey");

-- CreateIndex
CREATE INDEX "GameReminder_fired_fireAt_idx" ON "GameReminder"("fired", "fireAt");

-- CreateIndex
CREATE INDEX "GameReminder_gameId_idx" ON "GameReminder"("gameId");

-- CreateIndex
CREATE INDEX "GameReminder_guildId_channelId_idx" ON "GameReminder"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "PlayerAlias_guildId_idx" ON "PlayerAlias"("guildId");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_idx" ON "GameEvent"("gameId");

-- CreateIndex
CREATE INDEX "GameEvent_type_createdAt_idx" ON "GameEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "GameEvent_createdAt_idx" ON "GameEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_gameId_seq_key" ON "GameEvent"("gameId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "StQueueBoard_guildId_key" ON "StQueueBoard"("guildId");

-- CreateIndex
CREATE INDEX "StQueueBoard_threadId_idx" ON "StQueueBoard"("threadId");

-- CreateIndex
CREATE INDEX "StQueueEntry_guildId_status_idx" ON "StQueueEntry"("guildId", "status");

-- CreateIndex
CREATE INDEX "StQueueEntry_boardId_position_idx" ON "StQueueEntry"("boardId", "position");

-- CreateIndex
CREATE INDEX "StQueueEntry_ownerDiscordId_idx" ON "StQueueEntry"("ownerDiscordId");

-- CreateIndex
CREATE INDEX "StQueueMember_entryId_idx" ON "StQueueMember"("entryId");

-- CreateIndex
CREATE INDEX "StQueueMember_discordUserId_idx" ON "StQueueMember"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StQueueMember_entryId_discordUserId_role_key" ON "StQueueMember"("entryId", "discordUserId", "role");

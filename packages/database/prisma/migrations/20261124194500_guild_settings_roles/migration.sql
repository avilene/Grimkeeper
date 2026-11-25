-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN "allowedRoleIds" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "adminRoleIds" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "reminderRoleIds" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "reminderPingRoleId" TEXT;

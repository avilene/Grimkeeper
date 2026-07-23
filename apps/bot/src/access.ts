import type { CommandInteraction, Guild, GuildMember } from "discord.js";

/** Default budget for guild member REST/gateway lookups that can stall without GuildMembers intent. */
export const MEMBER_FETCH_TIMEOUT_MS = 2_000;

export function parseList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** True when the Discord user id is listed in `ALLOWED_USER_IDS` (roles do not count). */
export function isAllowedUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseList(process.env.ALLOWED_USER_IDS).has(userId);
}

/**
 * Fetch one guild member with a hard timeout.
 * Prefer this over bare `guild.members.fetch(id)` on interaction paths — hangs leave
 * ephemeral "Working…" replies stuck forever.
 */
export async function fetchGuildMemberWithTimeout(
  guild: Guild,
  userId: string,
  timeoutMs = MEMBER_FETCH_TIMEOUT_MS,
): Promise<GuildMember | null> {
  const cached = guild.members.cache?.get(userId);
  if (cached && !cached.partial) return cached;

  return Promise.race([
    guild.members.fetch(userId).catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

export async function canUseBot(interaction: CommandInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ALLOWED_USER_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);
  const userId = interaction?.user?.id;

  // No restrictions configured: allow everyone.
  if (allowedUserIds.size === 0 && allowedRoleIds.size === 0) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (allowedUserIds.has(userId)) {
    return true;
  }

  if (!interaction.guildId || allowedRoleIds.size === 0) {
    return false;
  }

  const guild = interaction.guild;
  if (!guild) return false;
  const member = await fetchGuildMemberWithTimeout(guild, userId);
  if (!member) return false;

  return member.roles.cache.some((role) => allowedRoleIds.has(role.id));
}

export async function isInExplicitAllowlist(interaction: CommandInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ALLOWED_USER_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);
  if (allowedUserIds.size === 0 && allowedRoleIds.size === 0) {
    return false;
  }

  const userId = interaction.user?.id;
  if (!userId) return false;

  if (allowedUserIds.has(userId)) {
    return true;
  }

  if (!interaction.guildId || allowedRoleIds.size === 0) {
    return false;
  }

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  if (!member) return false;

  return member.roles.cache.some((role) => allowedRoleIds.has(role.id));
}

export async function hasReminderManagerRole(interaction: CommandInteraction): Promise<boolean> {
  const reminderRoleIds = parseList(process.env.REMINDER_ROLE_IDS);
  if (reminderRoleIds.size === 0) return false;

  const userId = interaction.user?.id;
  if (!userId || !interaction.guildId) return false;

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  if (!member) return false;

  return member.roles.cache.some((role) => reminderRoleIds.has(role.id));
}

export async function canManageChannelReminders(interaction: CommandInteraction): Promise<boolean> {
  if (await isInExplicitAllowlist(interaction)) return true;
  return hasReminderManagerRole(interaction);
}

export function getReminderPingRoleId(): string | null {
  const roleId = process.env.REMINDER_PING_ROLE_ID?.trim();
  return roleId || null;
}

/** Role IDs that can help in private ST/player threads (Manage Threads on game channels). */
export function getAdminRoleIds(): Set<string> {
  return parseList(process.env.ADMIN_ROLE_IDS);
}

export async function hasAdminRole(interaction: CommandInteraction): Promise<boolean> {
  const adminRoleIds = getAdminRoleIds();
  if (adminRoleIds.size === 0) return false;

  const userId = interaction.user?.id;
  if (!userId || !interaction.guildId) return false;

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  if (!member) return false;

  return member.roles.cache.some((role) => adminRoleIds.has(role.id));
}

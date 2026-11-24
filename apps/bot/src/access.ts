import type { CommandInteraction, Guild, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { getGuildSettings } from "@grimkeeper/database";

/** Minimal interaction shape for allowlist / role checks (slash, buttons, selects). */
export type AccessInteraction = {
  user?: { id: string } | null;
  guildId?: string | null;
  guild?: Guild | null;
  member?: CommandInteraction["member"];
  memberPermissions?: CommandInteraction["memberPermissions"];
};

/** Default budget for guild member REST/gateway lookups that can stall without GuildMembers intent. */
export const MEMBER_FETCH_TIMEOUT_MS = 2_000;

export type GuildAccessConfig = {
  /** Role IDs that may use bot commands (plus global ADMIN_IDS). */
  allowedRoleIds: Set<string>;
  /** Role IDs granted private-thread / pin helper access. */
  adminRoleIds: Set<string>;
  /** Role IDs that may manage channel reminders without an active game. */
  reminderRoleIds: Set<string>;
  /** Default ping role for channel reminders. */
  reminderPingRoleId: string | null;
  /**
   * True when this guild has an explicit allowedRoleIds value in GuildSettings
   * (including empty string = open). False means env ALLOWED_ROLE_IDS still applies.
   */
  allowedRolesFromDb: boolean;
};

export function parseList(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** True when the Discord user id is listed in `ADMIN_IDS` (roles do not count). */
export function isAllowedUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseList(process.env.ADMIN_IDS).has(userId);
}

/**
 * Per-guild access config: GuildSettings columns when set, else env fallbacks.
 * `allowedRoleIds` null in DB → env; empty string in DB → open for this guild.
 */
export async function resolveGuildAccessConfig(
  guildId: string | null | undefined,
): Promise<GuildAccessConfig> {
  const envAllowed = parseList(process.env.ALLOWED_ROLE_IDS);
  const envAdmin = parseList(process.env.ADMIN_ROLE_IDS);
  const envReminder = parseList(process.env.REMINDER_ROLE_IDS);
  const envPing = process.env.REMINDER_PING_ROLE_ID?.trim() || null;

  if (!guildId) {
    return {
      allowedRoleIds: envAllowed,
      adminRoleIds: envAdmin,
      reminderRoleIds: envReminder,
      reminderPingRoleId: envPing,
      allowedRolesFromDb: false,
    };
  }

  const settings = await getGuildSettings(guildId);
  const allowedRolesFromDb = settings != null && settings.allowedRoleIds != null;

  return {
    allowedRoleIds: allowedRolesFromDb
      ? parseList(settings.allowedRoleIds)
      : envAllowed,
    adminRoleIds:
      settings?.adminRoleIds != null ? parseList(settings.adminRoleIds) : envAdmin,
    reminderRoleIds:
      settings?.reminderRoleIds != null
        ? parseList(settings.reminderRoleIds)
        : envReminder,
    reminderPingRoleId:
      settings?.reminderPingRoleId != null
        ? settings.reminderPingRoleId.trim() || null
        : envPing,
    allowedRolesFromDb,
  };
}

/**
 * Fetch one guild member with a hard timeout.
 * Prefer this over bare `guild.members.fetch(id)` on interaction paths — hangs leave
 * ephemeral "Working…" replies stuck forever.
 *
 * Pass `force: true` when checking Discord roles: without Guild Members intent the
 * member cache is often present but missing roles, and returning it skips REST.
 */
export async function fetchGuildMemberWithTimeout(
  guild: Guild,
  userId: string,
  timeoutMs = MEMBER_FETCH_TIMEOUT_MS,
  options?: { force?: boolean },
): Promise<GuildMember | null> {
  if (!options?.force) {
    const cached = guild.members.cache?.get(userId);
    if (cached && !cached.partial) return cached;
  }

  return Promise.race([
    guild.members.fetch({ user: userId, force: Boolean(options?.force) }).catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

/**
 * Role IDs from the slash/button interaction payload (no REST fetch).
 * Prefer this over guild.members.fetch — we do not request GuildMembers intent, so
 * fetches often time out and falsely deny ST-role users.
 *
 * Returns:
 * - `true` / `false` when the interaction payload lists roles as a string[] (authoritative)
 * - `true` when a GuildMember role cache hits
 * - `null` when there is no member, or a GuildMember cache miss (cache is often incomplete
 *   without Guild Members intent — callers should REST-fetch rather than deny)
 */
export function interactionMemberHasRole(
  interaction: Pick<AccessInteraction, "member">,
  roleId: string,
): boolean | null {
  return interactionMemberHasAnyRole(interaction, [roleId]);
}

/** Like `interactionMemberHasRole`, but true if the member has any of `roleIds`. */
export function interactionMemberHasAnyRole(
  interaction: Pick<AccessInteraction, "member">,
  roleIds: ReadonlySet<string> | readonly string[],
): boolean | null {
  const wanted = roleIds instanceof Set ? roleIds : new Set(roleIds);
  if (wanted.size === 0) return false;

  const member = interaction.member;
  if (!member) return null;

  const roles = member.roles;
  // APIInteractionGuildMember: roles is string[] from the interaction payload — complete.
  if (Array.isArray(roles)) {
    return roles.some((id) => wanted.has(id));
  }
  // GuildMember: RoleManager cache. A hit is trustworthy; a miss is not (incomplete cache).
  if (roles && typeof roles === "object" && "cache" in roles) {
    for (const id of wanted) {
      if (roles.cache.has(id)) return true;
    }
    return null;
  }
  return null;
}

/**
 * True when the member holds any of `roleIds`.
 * Uses the interaction payload first; force-fetches only when that payload is incomplete.
 */
export async function memberHasAnyRole(
  interaction: AccessInteraction,
  roleIds: ReadonlySet<string> | readonly string[],
): Promise<boolean> {
  const wanted = roleIds instanceof Set ? roleIds : new Set(roleIds);
  if (wanted.size === 0) return false;

  const fromPayload = interactionMemberHasAnyRole(interaction, wanted);
  if (fromPayload !== null) return fromPayload;

  const userId = interaction.user?.id;
  const guild = interaction.guild;
  if (!userId || !guild) return false;

  const member = await fetchGuildMemberWithTimeout(guild, userId, undefined, { force: true });
  if (!member) return false;
  for (const id of wanted) {
    if (member.roles.cache.has(id)) return true;
  }
  return false;
}

async function userMatchesAllowlist(
  interaction: AccessInteraction,
  allowedRoleIds: Set<string>,
): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const userId = interaction?.user?.id;
  if (!userId) return false;
  if (allowedUserIds.has(userId)) return true;
  if (!interaction.guildId || allowedRoleIds.size === 0) return false;
  return memberHasAnyRole(interaction, allowedRoleIds);
}

export async function canUseBot(interaction: AccessInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const config = await resolveGuildAccessConfig(interaction.guildId);

  // No restrictions configured: allow everyone.
  if (allowedUserIds.size === 0 && config.allowedRoleIds.size === 0) {
    return true;
  }

  return userMatchesAllowlist(interaction, config.allowedRoleIds);
}

export async function isInExplicitAllowlist(interaction: AccessInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const config = await resolveGuildAccessConfig(interaction.guildId);
  if (allowedUserIds.size === 0 && config.allowedRoleIds.size === 0) {
    return false;
  }

  return userMatchesAllowlist(interaction, config.allowedRoleIds);
}

export async function hasReminderManagerRole(interaction: AccessInteraction): Promise<boolean> {
  const config = await resolveGuildAccessConfig(interaction.guildId);
  if (config.reminderRoleIds.size === 0) return false;
  if (!interaction.user?.id || !interaction.guildId) return false;
  return memberHasAnyRole(interaction, config.reminderRoleIds);
}

export async function canManageChannelReminders(interaction: AccessInteraction): Promise<boolean> {
  if (await isInExplicitAllowlist(interaction)) return true;
  return hasReminderManagerRole(interaction);
}

/** @deprecated Prefer getReminderPingRoleIdForGuild — env-only fallback. */
export function getReminderPingRoleId(): string | null {
  const roleId = process.env.REMINDER_PING_ROLE_ID?.trim();
  return roleId || null;
}

export async function getReminderPingRoleIdForGuild(
  guildId: string | null | undefined,
): Promise<string | null> {
  const config = await resolveGuildAccessConfig(guildId);
  return config.reminderPingRoleId;
}

/** @deprecated Prefer getAdminRoleIdsForGuild — env-only fallback. */
export function getAdminRoleIds(): Set<string> {
  return parseList(process.env.ADMIN_ROLE_IDS);
}

export async function getAdminRoleIdsForGuild(
  guildId: string | null | undefined,
): Promise<Set<string>> {
  const config = await resolveGuildAccessConfig(guildId);
  return config.adminRoleIds;
}

export async function hasAdminRole(interaction: AccessInteraction): Promise<boolean> {
  const adminRoleIds = await getAdminRoleIdsForGuild(interaction.guildId);
  if (adminRoleIds.size === 0) return false;
  if (!interaction.user?.id || !interaction.guildId) return false;
  return memberHasAnyRole(interaction, adminRoleIds);
}

/** Manage Server / Administrator, or global ADMIN_IDS, or configured admin roles. */
export async function canConfigureGuild(interaction: AccessInteraction): Promise<boolean> {
  const userId = interaction.user?.id;
  if (!userId) return false;
  if (isAllowedUserId(userId)) return true;

  const perms = interaction.memberPermissions;
  if (
    perms?.has(PermissionFlagsBits.Administrator) ||
    perms?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  return hasAdminRole(interaction);
}

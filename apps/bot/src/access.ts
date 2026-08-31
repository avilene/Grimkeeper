import type { CommandInteraction, Guild, GuildMember } from "discord.js";

/** Minimal interaction shape for allowlist / role checks (slash, buttons, selects). */
export type AccessInteraction = {
  user?: { id: string } | null;
  guildId?: string | null;
  guild?: Guild | null;
  member?: CommandInteraction["member"];
};

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

/** True when the Discord user id is listed in `ADMIN_IDS` (roles do not count). */
export function isAllowedUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseList(process.env.ADMIN_IDS).has(userId);
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

async function userMatchesAllowlist(interaction: AccessInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);
  const userId = interaction?.user?.id;
  if (!userId) return false;
  if (allowedUserIds.has(userId)) return true;
  if (!interaction.guildId || allowedRoleIds.size === 0) return false;
  return memberHasAnyRole(interaction, allowedRoleIds);
}

export async function canUseBot(interaction: AccessInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);

  // No restrictions configured: allow everyone.
  if (allowedUserIds.size === 0 && allowedRoleIds.size === 0) {
    return true;
  }

  return userMatchesAllowlist(interaction);
}

export async function isInExplicitAllowlist(interaction: AccessInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ADMIN_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);
  if (allowedUserIds.size === 0 && allowedRoleIds.size === 0) {
    return false;
  }

  return userMatchesAllowlist(interaction);
}

export async function hasReminderManagerRole(interaction: AccessInteraction): Promise<boolean> {
  const reminderRoleIds = parseList(process.env.REMINDER_ROLE_IDS);
  if (reminderRoleIds.size === 0) return false;
  if (!interaction.user?.id || !interaction.guildId) return false;
  return memberHasAnyRole(interaction, reminderRoleIds);
}

export async function canManageChannelReminders(interaction: AccessInteraction): Promise<boolean> {
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

export async function hasAdminRole(interaction: AccessInteraction): Promise<boolean> {
  const adminRoleIds = getAdminRoleIds();
  if (adminRoleIds.size === 0) return false;
  if (!interaction.user?.id || !interaction.guildId) return false;
  return memberHasAnyRole(interaction, adminRoleIds);
}

/**
 * Discord REST helpers for admin access checks + basic metadata
 * (bot token from shared .env).
 */

type GuildMemberResponse = {
  nick?: string | null;
  roles?: string[];
  user?: {
    global_name?: string | null;
    username?: string | null;
  };
};

type ChannelResponse = {
  name?: string;
};

const memberRoleCache = new Map<string, Set<string> | null>();
const memberNameCache = new Map<string, string | null>();
const channelNameCache = new Map<string, string | null>();

function botToken(): string | undefined {
  return process.env.DISCORD_TOKEN?.trim() || undefined;
}

/**
 * Role ids for a guild member, or null if the member / guild is unavailable
 * (missing token, unknown member, missing access, rate limit, etc.).
 */
export async function fetchGuildMemberRoleIds(
  guildId: string,
  discordUserId: string,
): Promise<Set<string> | null> {
  const token = botToken();
  if (!token || !guildId || !discordUserId) return null;

  const cacheKey = `${guildId}:${discordUserId}`;
  if (memberRoleCache.has(cacheKey)) {
    return memberRoleCache.get(cacheKey) ?? null;
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
      {
        headers: { Authorization: `Bot ${token}` },
        cache: "no-store",
      },
    );
    if (res.status === 404 || res.status === 403) {
      memberRoleCache.set(cacheKey, null);
      return null;
    }
    if (!res.ok) {
      memberRoleCache.set(cacheKey, null);
      return null;
    }
    const body = (await res.json()) as GuildMemberResponse;
    const roles = new Set((body.roles ?? []).map(String));
    memberRoleCache.set(cacheKey, roles);
    return roles;
  } catch {
    memberRoleCache.set(cacheKey, null);
    return null;
  }
}

export async function fetchGuildMemberDisplayName(
  guildId: string,
  discordUserId: string,
): Promise<string | null> {
  const token = botToken();
  if (!token || !guildId || !discordUserId) return null;

  const cacheKey = `${guildId}:${discordUserId}`;
  if (memberNameCache.has(cacheKey)) {
    return memberNameCache.get(cacheKey) ?? null;
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
      {
        headers: { Authorization: `Bot ${token}` },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      memberNameCache.set(cacheKey, null);
      return null;
    }
    const body = (await res.json()) as GuildMemberResponse;
    const name = body.nick ?? body.user?.global_name ?? body.user?.username ?? null;
    memberNameCache.set(cacheKey, name);
    return name;
  } catch {
    memberNameCache.set(cacheKey, null);
    return null;
  }
}

export async function fetchChannelName(channelId: string): Promise<string | null> {
  const token = botToken();
  if (!token || !channelId) return null;

  if (channelNameCache.has(channelId)) {
    return channelNameCache.get(channelId) ?? null;
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      channelNameCache.set(channelId, null);
      return null;
    }
    const body = (await res.json()) as ChannelResponse;
    const name = body.name ?? null;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    channelNameCache.set(channelId, null);
    return null;
  }
}

import {
  AnyThreadChannel,
  ChannelType,
  Guild,
} from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

import { getAdminRoleIds } from "./access.js";
import {
  addRoleMembersToThread,
  DEFAULT_THREAD_AUTO_ARCHIVE,
  ensureThreadAutoArchive,
  GameRoleIds,
  isGameTextChannel,
  shortGameId,
} from "./commands/command-context.js";
import { discordTimestamp } from "./reminder-message.js";

const USER_MENTION_RE = /<@!?(\d{17,20})>/g;
const ROLE_MENTION_RE = /<@&(\d{17,20})>/g;

export function logThreadName(parentChannelName: string, gameId: string): string {
  return `log-${parentChannelName} · ${shortGameId(gameId)}`.slice(0, 100);
}

/** Non-pinging user reference for audit logs. */
export function formatLogUserRef(displayName: string, userId: string): string {
  const name = displayName.trim() || "user";
  return `${name} (\`${userId}\`)`;
}

/** Non-pinging role reference for audit logs. */
export function formatLogRoleRef(roleName: string, roleId: string): string {
  const name = roleName.trim() || "role";
  return `${name} (\`${roleId}\`)`;
}

/**
 * Replace Discord user/role mentions with name + id so the audit log never pings.
 */
export async function sanitizeGameLogMentions(guild: Guild, message: string): Promise<string> {
  const userIds = [...new Set([...message.matchAll(USER_MENTION_RE)].map((match) => match[1]!))];
  const roleIds = [...new Set([...message.matchAll(ROLE_MENTION_RE)].map((match) => match[1]!))];

  const users = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      const member = await guild.members.fetch(userId).catch(() => null);
      const name =
        member?.displayName ??
        member?.user.globalName ??
        member?.user.username ??
        "unknown";
      users.set(userId, name);
    }),
  );

  const roles = new Map<string, string>();
  for (const roleId of roleIds) {
    const cached = guild.roles.cache.get(roleId);
    if (cached) {
      roles.set(roleId, cached.name);
      continue;
    }
    const fetched = await guild.roles.fetch(roleId).catch(() => null);
    roles.set(roleId, fetched?.name ?? "unknown-role");
  }

  return message
    .replace(USER_MENTION_RE, (_match, userId: string) =>
      formatLogUserRef(users.get(userId) ?? "unknown", userId),
    )
    .replace(ROLE_MENTION_RE, (_match, roleId: string) =>
      formatLogRoleRef(roles.get(roleId) ?? "unknown-role", roleId),
    );
}

/** Prefix with Discord short date/time so each viewer sees their local timezone. */
export function formatGameLogLine(message: string, at = new Date()): string {
  return `${discordTimestamp(at, "f")} ${message}`;
}

export type GameThreadRecord = GameRoleIds & {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
  logThreadId?: string | null;
};

export async function getLogThreadForGame(
  guild: Guild,
  game: Pick<GameThreadRecord, "id" | "channelId" | "logThreadId">,
): Promise<AnyThreadChannel | null> {
  if (game.logThreadId) {
    const byId = await guild.channels.fetch(game.logThreadId).catch(() => null);
    if (byId?.isThread() && byId.parentId === game.channelId) {
      // Reject IDs that clearly belong to another game (game-scoped name mismatch).
      const short = shortGameId(game.id);
      if (!byId.name.includes(" · ") || byId.name.includes(short)) {
        return byId;
      }
    }
  }

  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  const parentName = parent && "name" in parent ? parent.name : "game";
  // Game-scoped name only — never reuse another game's `log-{channel}` thread.
  const expectedName = logThreadName(parentName, game.id);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) =>
      candidate.parentId === game.channelId && candidate.name === expectedName,
  );
  if (activeThread) return activeThread;

  if (!isGameTextChannel(parent)) return null;

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => candidate.name === expectedName) ?? null;
}

async function addStOnlyMembersToThread(
  guild: Guild,
  thread: AnyThreadChannel,
  game: GameRoleIds,
  storytellerIds: string[],
): Promise<void> {
  if (game.stRoleId) {
    await addRoleMembersToThread(guild, thread, game.stRoleId);
  }
  for (const stId of storytellerIds) {
    await thread.members.add(stId).catch(() => undefined);
  }
  for (const adminRoleId of getAdminRoleIds()) {
    await addRoleMembersToThread(guild, thread, adminRoleId);
  }
}

export async function ensureLogThread(
  guild: Guild,
  game: GameThreadRecord,
  engine: GameEngine | null,
  options?: { existingThreadId?: string; invokerId?: string },
): Promise<{ thread: AnyThreadChannel | null; created: boolean; threadId: string | null }> {
  const storytellerIds = engine?.getStorytellerDiscordIds() ?? [];
  let thread: AnyThreadChannel | null = null;
  let created = false;

  if (options?.existingThreadId) {
    const existing = await guild.channels.fetch(options.existingThreadId).catch(() => null);
    if (existing?.isThread() && existing.parentId === game.channelId) {
      thread = existing;
    }
  }

  if (!thread) {
    thread = await getLogThreadForGame(guild, game);
  }

  if (!thread) {
    const parent = await guild.channels.fetch(game.channelId).catch(() => null);
    if (!isGameTextChannel(parent)) {
      return { thread: null, created: false, threadId: null };
    }

    const threadName = logThreadName(parent.name, game.id);
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
        reason: `ST audit log for game ${game.id}`,
        ...( {
          type: ChannelType.PrivateThread,
          invitable: false,
        } as Record<string, unknown>),
      });
      created = true;
      await thread
        .send("**Game audit log** (ST-only). Role changes, broadcasts, reminders, and setup events appear here.")
        .catch(() => undefined);
    } catch {
      return { thread: null, created: false, threadId: null };
    }
  }

  if (thread.archived) {
    await thread.setArchived(false, "Reopening game audit log.").catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  if (options?.invokerId) {
    await thread.members.add(options.invokerId).catch(() => undefined);
  }

  await addStOnlyMembersToThread(guild, thread, game, storytellerIds);

  return { thread, created, threadId: thread.id };
}

export async function postGameLog(
  guild: Guild,
  game: Pick<GameThreadRecord, "id" | "channelId" | "logThreadId">,
  message: string,
): Promise<boolean> {
  const thread = await getLogThreadForGame(guild, game);
  if (!thread?.isTextBased()) return false;
  const safeMessage = await sanitizeGameLogMentions(guild, message);
  await thread
    .send({
      content: formatGameLogLine(safeMessage),
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
  return true;
}

export async function postGameLogRoleChange(
  guild: Guild,
  game: Pick<GameThreadRecord, "id" | "channelId" | "logThreadId">,
  action: "added" | "removed",
  userId: string,
  roleLabel: string,
  actorId?: string,
): Promise<void> {
  const actor = actorId ? `<@${actorId}>` : "System";
  await postGameLog(
    guild,
    game,
    `${actor} **${action}** ${roleLabel} for <@${userId}>`,
  );
}

/** Audit-log line for a player (or ST-set) ballot. */
export function formatVoteCastLogMessage(options: {
  voterDiscordId: string;
  nomineeLabel: string;
  choice: string;
  ballot: "private" | "public";
  /** When an ST sets another player's vote. */
  setByDiscordId?: string;
}): string {
  const { voterDiscordId, nomineeLabel, choice, ballot, setByDiscordId } = options;
  if (setByDiscordId && setByDiscordId !== voterDiscordId) {
    return `<@${setByDiscordId}> set <@${voterDiscordId}> **${ballot}** vote on **${nomineeLabel}** to **${choice}**.`;
  }
  return `<@${voterDiscordId}> set a **${ballot}** vote on **${nomineeLabel}** to **${choice}**.`;
}

export async function postGameLogVoteCast(
  guild: Guild,
  game: Pick<GameThreadRecord, "id" | "channelId" | "logThreadId">,
  options: {
    voterDiscordId: string;
    nomineeLabel: string;
    choice: string;
    ballot: "private" | "public";
    setByDiscordId?: string;
  },
): Promise<void> {
  await postGameLog(guild, game, formatVoteCastLogMessage(options));
}

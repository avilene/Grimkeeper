import {
  AnyThreadChannel,
  ChannelType,
  Guild,
  ThreadAutoArchiveDuration,
} from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

import { getAdminRoleIds } from "./access.js";
import {
  addRoleMembersToThread,
  GameRoleIds,
  isGameTextChannel,
} from "./commands/command-context.js";

export function logThreadName(parentChannelName: string): string {
  return `log-${parentChannelName}`.slice(0, 100);
}

export function formatGameLogLine(message: string, at = new Date()): string {
  const ts = at.toISOString().replace("T", " ").slice(0, 19);
  return `\`[${ts}]\` ${message}`;
}

export type GameThreadRecord = GameRoleIds & {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
  logThreadId?: string | null;
};

export async function getLogThreadForGame(
  guild: Guild,
  game: Pick<GameThreadRecord, "channelId" | "logThreadId">,
): Promise<AnyThreadChannel | null> {
  if (game.logThreadId) {
    const byId = await guild.channels.fetch(game.logThreadId).catch(() => null);
    if (byId?.isThread() && byId.parentId === game.channelId) {
      return byId;
    }
  }

  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  const parentName = parent && "name" in parent ? parent.name : "game";
  const expectedName = logThreadName(parentName);

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

    const threadName = logThreadName(parent.name);
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
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

  if (options?.invokerId) {
    await thread.members.add(options.invokerId).catch(() => undefined);
  }

  await addStOnlyMembersToThread(guild, thread, game, storytellerIds);

  return { thread, created, threadId: thread.id };
}

export async function postGameLog(
  guild: Guild,
  game: Pick<GameThreadRecord, "channelId" | "logThreadId">,
  message: string,
): Promise<boolean> {
  const thread = await getLogThreadForGame(guild, game);
  if (!thread?.isTextBased()) return false;
  await thread.send(formatGameLogLine(message)).catch(() => undefined);
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

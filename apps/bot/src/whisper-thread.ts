import {
  ChannelType,
  type Guild,
  type AnyThreadChannel,
} from "discord.js";
import {
  createGameWhisper,
  findGameWhisperByParticipants,
  listGameWhispers,
} from "@grimkeeper/database";
import { isFakePlayer, type GameEngine, type PlayerState } from "@grimkeeper/engine";

import {
  DEFAULT_THREAD_AUTO_ARCHIVE,
  addStorytellersToPlayerThread,
  ensureThreadAutoArchive,
  isGameTextChannel,
} from "./commands/command-context.js";

export function defaultPairWhisperName(
  creatorDisplayName: string,
  targetDisplayName: string,
  neighbor: boolean,
): string {
  const base = `${creatorDisplayName} & ${targetDisplayName}`;
  return (neighbor ? `${base} NW` : base).slice(0, 100);
}

/** @deprecated Use defaultPairWhisperName */
export function defaultWhisperName(
  creatorDisplayName: string,
  targetDisplayName: string,
  neighbor: boolean,
): string {
  return defaultPairWhisperName(creatorDisplayName, targetDisplayName, neighbor);
}

export function defaultGroupWhisperName(displayNames: string[]): string {
  return `Group (${displayNames.join(", ")})`.slice(0, 100);
}

export function resolveWhisperThreadName(options: {
  name?: string;
  neighbor: boolean;
  displayNames: string[];
}): string {
  const custom = options.name?.trim();
  if (custom) {
    if (options.neighbor && !/\bNW\b/i.test(custom)) {
      return `${custom} NW`.slice(0, 100);
    }
    return custom.slice(0, 100);
  }

  if (options.displayNames.length <= 2) {
    return defaultPairWhisperName(
      options.displayNames[0] ?? "?",
      options.displayNames[1] ?? "?",
      options.neighbor,
    );
  }

  return defaultGroupWhisperName(options.displayNames);
}

/**
 * True when both players have seats and sit next to each other in the circle
 * (adjacent seat numbers, wrapping 1 ↔ N).
 */
export function areSeatedNeighbors(
  a: { seat: number | null },
  b: { seat: number | null },
  playerCount: number,
): boolean {
  if (a.seat == null || b.seat == null) return false;
  if (playerCount < 2) return false;
  if (a.seat === b.seat) return false;
  const diff = Math.abs(a.seat - b.seat);
  return diff === 1 || diff === playerCount - 1;
}

/** Left/right seated neighbors for a player (circle wrap). */
export function getSeatedNeighborPlayers(
  player: Pick<PlayerState, "seat" | "id">,
  players: PlayerState[],
): PlayerState[] {
  if (player.seat == null) return [];
  const seatCount = players.length;
  if (seatCount < 2) return [];

  const leftSeat = player.seat === 1 ? seatCount : player.seat - 1;
  const rightSeat = player.seat === seatCount ? 1 : player.seat + 1;
  const neighbors: PlayerState[] = [];
  for (const seat of new Set([leftSeat, rightSeat])) {
    const occupant = players.find((candidate) => candidate.seat === seat);
    if (occupant && occupant.id !== player.id) neighbors.push(occupant);
  }
  return neighbors;
}

export function formatWhisperDayMarker(dayNumber: number): string {
  return `## Day ${dayNumber}`;
}

export function formatWhisperOpenMessage(
  participantDiscordIds: string[],
  phase: "day" | "night",
  phaseNumber: number,
): string {
  const header = phase === "day" ? formatWhisperDayMarker(phaseNumber) : `## Night ${phaseNumber}`;
  const mentions = participantDiscordIds.map((id) => `<@${id}>`).join(", ");
  return [
    header,
    "",
    `Whisper between ${mentions}.`,
    "_Storyteller can see this thread. @mention someone to invite them in._",
  ].join("\n");
}

export function formatWhisperReusePing(participantDiscordIds: string[]): string {
  return `${participantDiscordIds.map((id) => `<@${id}>`).join(" ")} — whisper resumed.`;
}

export function formatWhisperDeclaration(displayNames: string[]): string {
  if (displayNames.length <= 2) {
    return `Whisper created between ${displayNames[0] ?? "?"} and ${displayNames[1] ?? "?"}`;
  }
  return `Whisper created between ${displayNames.join(", ")}`;
}

async function ensureWhisperMembers(
  guild: Guild,
  thread: AnyThreadChannel,
  engine: GameEngine,
  participantDiscordIds: string[],
  stRoleId?: string | null,
): Promise<void> {
  for (const userId of participantDiscordIds) {
    if (isFakePlayer(userId)) continue;
    await thread.members.add(userId).catch(() => undefined);
  }
  // Engine STs + anyone cached with the game ST Discord role (not only the original ST).
  await addStorytellersToPlayerThread(guild, thread, engine, stRoleId);
}

export type OpenWhisperResult = {
  thread: AnyThreadChannel;
  reused: boolean;
};

export type OpenWhisperOptions = {
  creatorDiscordId: string;
  /** All player members including the creator. */
  participants: Array<{ discordUserId: string; displayName: string }>;
  name?: string;
  neighbor: boolean;
};

/** Reuse an existing whisper for this participant set if present; otherwise create one. */
export async function openOrReuseWhisperThread(
  guild: Guild,
  game: { id: string; channelId: string; stRoleId?: string | null },
  engine: GameEngine,
  options: OpenWhisperOptions,
): Promise<OpenWhisperResult | null> {
  const participantDiscordIds = options.participants.map((p) => p.discordUserId);
  if (participantDiscordIds.length < 2) return null;

  const existing = await findGameWhisperByParticipants(game.id, participantDiscordIds);
  if (existing) {
    const channel = await guild.channels.fetch(existing.threadId).catch(() => null);
    if (channel?.isThread()) {
      if (channel.archived) {
        await channel
          .setArchived(false, "Reopening existing whisper thread.")
          .catch(() => undefined);
      }
      await ensureThreadAutoArchive(channel);
      await ensureWhisperMembers(guild, channel, engine, participantDiscordIds, game.stRoleId);
      await channel
        .send({
          content: formatWhisperReusePing(participantDiscordIds),
          allowedMentions: { users: participantDiscordIds },
        })
        .catch(() => undefined);
      return { thread: channel, reused: true };
    }
  }

  const created = await createWhisperThread(guild, game, engine, options);
  return created ? { thread: created, reused: false } : null;
}

export async function createWhisperThread(
  guild: Guild,
  game: { id: string; channelId: string; stRoleId?: string | null },
  engine: GameEngine,
  options: OpenWhisperOptions,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const participants = options.participants;
  const participantDiscordIds = participants.map((p) => p.discordUserId);
  if (participantDiscordIds.length < 2) return null;

  const displayNames = participants.map((p) => p.displayName);
  const name = resolveWhisperThreadName({
    name: options.name,
    neighbor: options.neighbor,
    displayNames,
  });

  let thread: AnyThreadChannel;
  try {
    thread = await parent.threads.create({
      name,
      autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
      reason: `Whisper for game ${game.id}`,
      ...( {
        type: ChannelType.PrivateThread,
        invitable: true,
      } as Record<string, unknown>),
    });
  } catch {
    return null;
  }

  await ensureThreadAutoArchive(thread);
  await ensureWhisperMembers(guild, thread, engine, participantDiscordIds, game.stRoleId);

  const state = engine.getState();
  const phase = state.phase === "night" ? "night" : "day";
  const phaseNumber = phase === "night" ? state.nightNumber : state.dayNumber || 1;

  await thread
    .send({
      content: formatWhisperOpenMessage(participantDiscordIds, phase, phaseNumber),
      allowedMentions: { users: participantDiscordIds },
    })
    .catch(() => undefined);

  const others = participants.filter((p) => p.discordUserId !== options.creatorDiscordId);
  await createGameWhisper({
    gameId: game.id,
    threadId: thread.id,
    name: thread.name,
    neighbor: options.neighbor,
    creatorDiscordId: options.creatorDiscordId,
    targetDiscordId: others[0]?.discordUserId ?? "",
    participantDiscordIds,
  });

  return thread;
}

/** Post `## Day N` into every whisper thread for this game. */
export async function postDayMarkersToWhispers(
  guild: Guild,
  gameId: string,
  dayNumber: number,
): Promise<{ posted: number; failed: number }> {
  const whispers = await listGameWhispers(gameId);
  let posted = 0;
  let failed = 0;
  const content = formatWhisperDayMarker(dayNumber);

  for (const whisper of whispers) {
    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) {
      failed++;
      continue;
    }

    if (channel.archived) {
      await channel.setArchived(false, `Day ${dayNumber} whisper marker`).catch(() => undefined);
    }

    const ok = await channel
      .send({ content, allowedMentions: { parse: [] } })
      .then(() => true)
      .catch(() => false);
    if (ok) posted++;
    else failed++;
  }

  return { posted, failed };
}

/** Invite a user into every whisper thread for this game. Returns how many threads were updated. */
export async function addUserToGameWhispers(
  guild: Guild,
  gameId: string,
  userId: string,
): Promise<number> {
  if (isFakePlayer(userId)) return 0;
  const whispers = await listGameWhispers(gameId);
  let updated = 0;
  for (const whisper of whispers) {
    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) continue;
    if (channel.archived) {
      await channel.setArchived(false, "Adding storyteller to whisper.").catch(() => undefined);
    }
    const ok = await channel.members.add(userId).then(() => true).catch(() => false);
    if (ok) updated++;
  }
  return updated;
}

/**
 * Remove a user from whisper threads for this game.
 * Skips threads where they are a player participant (not only an ST observer).
 */
export async function removeUserFromGameWhispers(
  guild: Guild,
  gameId: string,
  userId: string,
): Promise<number> {
  if (isFakePlayer(userId)) return 0;
  const whispers = await listGameWhispers(gameId);
  let updated = 0;
  for (const whisper of whispers) {
    const participants = whisper.participantKey.split(",").filter(Boolean);
    if (participants.includes(userId)) continue;

    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) continue;
    if (channel.archived) {
      await channel.setArchived(false, "Removing storyteller from whisper.").catch(() => undefined);
    }
    const ok = await channel.members.remove(userId).then(() => true).catch(() => false);
    if (ok) updated++;
  }
  return updated;
}

/** Invite engine STs + ST-role holders into every whisper thread for this game. */
export async function syncStorytellersToWhisperThreads(
  guild: Guild,
  game: { id: string; stRoleId?: string | null },
  engine: GameEngine,
): Promise<number> {
  const whispers = await listGameWhispers(game.id);
  let updated = 0;
  for (const whisper of whispers) {
    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) continue;
    if (channel.archived) {
      await channel
        .setArchived(false, "Syncing storytellers into whisper threads.")
        .catch(() => undefined);
    }
    await addStorytellersToPlayerThread(guild, channel, engine, game.stRoleId);
    updated++;
  }
  return updated;
}

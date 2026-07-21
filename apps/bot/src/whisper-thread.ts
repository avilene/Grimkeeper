import {
  ChannelType,
  type Guild,
  type AnyThreadChannel,
} from "discord.js";
import { createGameWhisper, listGameWhispers } from "@grimkeeper/database";
import { isFakePlayer, type GameEngine } from "@grimkeeper/engine";

import {
  DEFAULT_THREAD_AUTO_ARCHIVE,
  ensureThreadAutoArchive,
  isGameTextChannel,
} from "./commands/command-context.js";

export function defaultWhisperName(
  creatorDisplayName: string,
  targetDisplayName: string,
  neighbor: boolean,
): string {
  const base = `${creatorDisplayName} & ${targetDisplayName}`;
  return (neighbor ? `${base} NW` : base).slice(0, 100);
}

export function formatWhisperDayMarker(dayNumber: number): string {
  return `## Day ${dayNumber}`;
}

export function formatWhisperOpenMessage(
  creatorDiscordId: string,
  targetDiscordId: string,
  phase: "day" | "night",
  phaseNumber: number,
): string {
  const header = phase === "day" ? formatWhisperDayMarker(phaseNumber) : `## Night ${phaseNumber}`;
  return [
    header,
    "",
    `Whisper between <@${creatorDiscordId}> and <@${targetDiscordId}>.`,
    "_Storyteller can see this thread. @mention someone to invite them in._",
  ].join("\n");
}

export async function createWhisperThread(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  options: {
    creatorDiscordId: string;
    targetDiscordId: string;
    creatorDisplayName: string;
    targetDisplayName: string;
    name?: string;
    neighbor: boolean;
  },
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const name =
    options.name?.trim() ||
    defaultWhisperName(options.creatorDisplayName, options.targetDisplayName, options.neighbor);

  let thread: AnyThreadChannel;
  try {
    thread = await parent.threads.create({
      name: name.slice(0, 100),
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

  const memberIds = new Set([
    options.creatorDiscordId,
    options.targetDiscordId,
    ...engine.getStorytellerDiscordIds(),
  ]);
  for (const userId of memberIds) {
    if (isFakePlayer(userId)) continue;
    await thread.members.add(userId).catch(() => undefined);
  }

  const state = engine.getState();
  const phase = state.phase === "night" ? "night" : "day";
  const phaseNumber = phase === "night" ? state.nightNumber : state.dayNumber || 1;

  await thread
    .send({
      content: formatWhisperOpenMessage(
        options.creatorDiscordId,
        options.targetDiscordId,
        phase,
        phaseNumber,
      ),
      allowedMentions: {
        users: [options.creatorDiscordId, options.targetDiscordId],
      },
    })
    .catch(() => undefined);

  await createGameWhisper({
    gameId: game.id,
    threadId: thread.id,
    name: thread.name,
    neighbor: options.neighbor,
    creatorDiscordId: options.creatorDiscordId,
    targetDiscordId: options.targetDiscordId,
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

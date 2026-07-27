import type { Guild } from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";
import { GameCommandKind } from "@grimkeeper/engine";

import {
  getStorytellerThread,
  persistEvents,
  refreshAllNominationEverywhere,
  type KibVenue,
} from "./commands/command-context.js";
import {
  parseNominationIdFromFooter,
  postNominationToChannelDetailed,
  type DayDiscussionChannel,
} from "./day-thread.js";
import { postGameLog } from "./game-log-thread.js";
import {
  cancelVoteDeadlineReminder,
  scheduleNominationVoteDeadlineReminder,
} from "./interactions/lock-votes.js";
import { upsertStControlPanel } from "./st-control-panel.js";
import { upsertStVoteTracker } from "./st-vote-tracker.js";

type BulkGame = {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
  guildId?: string | null;
};

async function findOpenNominationMessagesInKib(
  channel: KibVenue,
  openNominationIds: Set<string>,
  options?: { maxPages?: number },
) {
  const pageSize = 100;
  const maxPages = options?.maxPages ?? 10;
  const found: { id: string; nominationId: string }[] = [];
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const messages = await channel.messages
      .fetch(before ? { limit: pageSize, before } : { limit: pageSize })
      .catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const message of messages.values()) {
      const nominationId = parseNominationIdFromFooter(message.embeds[0]?.footer?.text);
      if (nominationId && openNominationIds.has(nominationId)) {
        found.push({ id: message.id, nominationId });
      }
    }

    const oldest = messages.last();
    if (!oldest || messages.size < pageSize) break;
    before = oldest.id;
  }

  return found;
}

/** Force-fail every open nomination; refresh Discord surfaces. */
export async function failAllOpenNominations(
  guild: Guild,
  game: BulkGame,
  engine: GameEngine,
  actorDiscordId: string,
): Promise<{ count: number; message: string }> {
  const open =
    engine.getState().day?.nominations.filter((nomination) => nomination.status === "open") ?? [];
  if (open.length === 0) {
    return { count: 0, message: "No open nominations remain to fail." };
  }

  const events = engine.handle({
    kind: GameCommandKind.FailOpenNominations,
    gameId: game.id,
  });
  await persistEvents(engine, events);

  for (const nomination of open) {
    await cancelVoteDeadlineReminder(nomination.id);
  }

  await refreshAllNominationEverywhere(guild, game, engine, { revealSecret: true });
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  await postGameLog(
    guild,
    game,
    `<@${actorDiscordId}> force-failed **${open.length}** open nomination${open.length === 1 ? "" : "s"}.`,
  );

  return {
    count: open.length,
    message: `Failed **${open.length}** open nomination${open.length === 1 ? "" : "s"}.`,
  };
}

/** Extend every current-day nomination deadline by `hours`; unlock locked open noms. */
export async function extendAllNominationDeadlines(
  guild: Guild,
  game: BulkGame,
  engine: GameEngine,
  hours: number,
  actorDiscordId: string,
): Promise<{ count: number; message: string }> {
  const nominations = engine.getState().day?.nominations ?? [];
  if (nominations.length === 0) {
    return { count: 0, message: "No nominations today to extend." };
  }

  const events = engine.handle({
    kind: GameCommandKind.ExtendNominationDeadlines,
    gameId: game.id,
    hours,
  });
  await persistEvents(engine, events);

  await refreshAllNominationEverywhere(guild, game, engine, { revealSecret: true });
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  for (const nomination of nominations) {
    const updated = engine.getNominationById(nomination.id);
    const reminderGame = {
      id: game.id,
      channelId: game.channelId,
      kibThreadId: game.kibThreadId,
      guildId: game.guildId ?? engine.getState().guildId,
    };
    if (updated?.status === "open" && updated.voteDeadlineAt) {
      await scheduleNominationVoteDeadlineReminder(guild, reminderGame, engine, nomination.id).catch(
        () => undefined,
      );
    } else {
      await cancelVoteDeadlineReminder(nomination.id);
    }
  }

  await postGameLog(
    guild,
    game,
    `<@${actorDiscordId}> extended **${nominations.length}** nomination deadline${nominations.length === 1 ? "" : "s"} by **${hours}** hour${hours === 1 ? "" : "s"}.`,
  );

  return {
    count: nominations.length,
    message: `Extended **${nominations.length}** nomination deadline${nominations.length === 1 ? "" : "s"} by **${hours}** hour${hours === 1 ? "" : "s"}.`,
  };
}

/**
 * Delete open-nomination embeds in kib and re-post them at the bottom (no Vote buttons).
 * Town Voting embeds are left alone.
 */
export async function repostOpenNominationsToKib(
  guild: Guild,
  game: BulkGame,
  engine: GameEngine,
): Promise<{ posted: number; deleted: number; message: string }> {
  const kib = await getStorytellerThread(guild, game.channelId, {
    kibThreadId: game.kibThreadId,
    gameId: game.id,
  });
  if (!kib?.isTextBased()) {
    return { posted: 0, deleted: 0, message: "Could not find kib to repost nominations." };
  }

  const open =
    engine
      .getState()
      .day?.nominations.filter((nomination) => nomination.status === "open")
      .slice()
      .sort((a, b) => a.order - b.order) ?? [];

  if (open.length === 0) {
    return { posted: 0, deleted: 0, message: "No open nominations to repost in kib." };
  }

  const openIds = new Set(open.map((nomination) => nomination.id));
  const existing = await findOpenNominationMessagesInKib(kib, openIds);
  let deleted = 0;
  for (const message of existing) {
    const removed = await kib.messages.delete(message.id).catch(() => null);
    if (removed) deleted += 1;
  }

  let posted = 0;
  for (const nomination of open) {
    const result = await postNominationToChannelDetailed(
      engine,
      game.id,
      kib as DayDiscussionChannel,
      nomination.id,
      {
        omitVoteButtons: true,
        omitAnnouncement: true,
      },
    );
    if (result.message) posted += 1;
  }

  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  return {
    posted,
    deleted,
    message: `Reposted **${posted}** open nomination${posted === 1 ? "" : "s"} in kib (removed **${deleted}** prior copy${deleted === 1 ? "" : "ies"}).`,
  };
}

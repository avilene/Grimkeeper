import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type AnyThreadChannel,
  type Guild,
  type Message,
} from "discord.js";
import { prisma } from "@grimkeeper/database";
import type { GameEngine, NominationRecord } from "@grimkeeper/engine";

import { ensureStorytellerThread, getStorytellerThread } from "./commands/command-context.js";
import { formatBlockContestSummary } from "./day-thread.js";
import { reportError } from "./error-reporter.js";
import { encodeIdPair, parseIdPair } from "./interaction-ids.js";
import { log } from "./logger.js";

export const VOTE_TRACKER_FOOTER_PREFIX = "grimkeeper:vote-tracker:";
export const LOCK_VOTES_BUTTON_PREFIX = "gk:lock-votes:";
export const UNLOCK_VOTES_BUTTON_PREFIX = "gk:unlock-votes:";
export const START_COUNT_BUTTON_PREFIX = "gk:start-count:";
export const COUNT_YES_BUTTON_PREFIX = "gk:count-yes:";
export const COUNT_NO_BUTTON_PREFIX = "gk:count-no:";
export const CANCEL_COUNT_BUTTON_PREFIX = "gk:cancel-count:";
export const PING_MISSING_BUTTON_PREFIX = "gk:ping-missing:";
export const PING_HAND_BUTTON_PREFIX = "gk:ping-hand:";
export const ANNOUNCE_BLOCK_BUTTON_PREFIX = "gk:announce-block:";

export function voteTrackerFooter(gameId: string): string {
  return `${VOTE_TRACKER_FOOTER_PREFIX}${gameId}`;
}

export function parseVoteTrackerFooter(footerText: string | null | undefined): string | null {
  if (!footerText?.startsWith(VOTE_TRACKER_FOOTER_PREFIX)) return null;
  return footerText.slice(VOTE_TRACKER_FOOTER_PREFIX.length) || null;
}

export function lockVotesButtonCustomId(gameId: string, nominationId: string): string {
  return `${LOCK_VOTES_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function unlockVotesButtonCustomId(gameId: string, nominationId: string): string {
  return `${UNLOCK_VOTES_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function startCountButtonCustomId(gameId: string, nominationId: string): string {
  return `${START_COUNT_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function countYesButtonCustomId(gameId: string, nominationId: string): string {
  return `${COUNT_YES_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function countNoButtonCustomId(gameId: string, nominationId: string): string {
  return `${COUNT_NO_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function cancelCountButtonCustomId(gameId: string, nominationId: string): string {
  return `${CANCEL_COUNT_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function pingMissingButtonCustomId(gameId: string, nominationId: string): string {
  return `${PING_MISSING_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function pingHandButtonCustomId(gameId: string, nominationId: string): string {
  return `${PING_HAND_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function announceBlockButtonCustomId(gameId: string, nominationId: string): string {
  return `${ANNOUNCE_BLOCK_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export type VoteTrackerButtonAction =
  | "lock"
  | "unlock"
  | "start-count"
  | "count-yes"
  | "count-no"
  | "cancel-count"
  | "ping-missing"
  | "ping-hand"
  | "announce-block";

const VOTE_TRACKER_BUTTON_PREFIXES: { prefix: string; action: VoteTrackerButtonAction }[] = [
  { prefix: LOCK_VOTES_BUTTON_PREFIX, action: "lock" },
  { prefix: UNLOCK_VOTES_BUTTON_PREFIX, action: "unlock" },
  { prefix: START_COUNT_BUTTON_PREFIX, action: "start-count" },
  { prefix: COUNT_YES_BUTTON_PREFIX, action: "count-yes" },
  { prefix: COUNT_NO_BUTTON_PREFIX, action: "count-no" },
  { prefix: CANCEL_COUNT_BUTTON_PREFIX, action: "cancel-count" },
  { prefix: PING_MISSING_BUTTON_PREFIX, action: "ping-missing" },
  { prefix: PING_HAND_BUTTON_PREFIX, action: "ping-hand" },
  { prefix: ANNOUNCE_BLOCK_BUTTON_PREFIX, action: "announce-block" },
];

export function parseLockVotesButtonCustomId(
  customId: string,
): { gameId: string; nominationId: string; lock: boolean } | null {
  const parsed = parseVoteTrackerButtonCustomId(customId);
  if (!parsed || (parsed.action !== "lock" && parsed.action !== "unlock")) return null;
  return {
    gameId: parsed.gameId,
    nominationId: parsed.nominationId,
    lock: parsed.action === "lock",
  };
}

export function parseVoteTrackerButtonCustomId(
  customId: string,
): { gameId: string; nominationId: string; action: VoteTrackerButtonAction } | null {
  const match = VOTE_TRACKER_BUTTON_PREFIXES.find(({ prefix }) => customId.startsWith(prefix));
  if (!match) return null;
  const parsed = parseIdPair(customId.slice(match.prefix.length));
  if (!parsed) return null;
  return {
    gameId: parsed.left,
    nominationId: parsed.right,
    action: match.action,
  };
}

function nominationTrackerBlock(engine: GameEngine, nomination: NominationRecord): string {
  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const tally = engine.formatNominationTally(nomination.id, { revealSecret: true });
  const roll = engine.formatNominationVoteRoll(nomination.id, { audience: "storyteller" });
  const hand = engine.getCountHandPlayer(nomination.id);
  let lockLabel: string;
  if (nomination.votesLocked) {
    lockLabel = "🔒 **LOCKED**";
  } else if (hand) {
    const ghostNote = hand.alive ? "" : " (ghost available)";
    lockLabel = `🖐 **HAND → ${hand.displayName}${ghostNote}**`;
  } else {
    lockLabel = "🔓 Open for changes";
  }
  const status =
    nomination.status === "open"
      ? lockLabel
      : nomination.status.replace("resolved_", "").replace("_", " ");

  return [
    `**${nominator?.displayName ?? "?"}** → **${nominee?.displayName ?? "?"}** (${status})`,
    `_Lock-in order: after nominee, around the circle (nominee last)._`,
    tally,
    roll,
  ].join("\n");
}

export function buildStVoteTrackerEmbed(engine: GameEngine): EmbedBuilder {
  const day = engine.getState().day;
  const open = day?.nominations.filter((nomination) => nomination.status === "open") ?? [];
  const resolved =
    day?.nominations.filter((nomination) => nomination.status !== "open").slice(-3) ?? [];

  const description =
    open.length === 0
      ? "_No open nominations._ Nominate in Town Voting; this panel updates here for ST tracking (including private ST-thread ballots)."
      : open.map((nomination) => nominationTrackerBlock(engine, nomination)).join("\n\n");

    const living = engine.countLivingPlayers();
    const needed = engine.votesNeededOnTheBlock();
    const embed = new EmbedBuilder()
      .setTitle("ST vote tracker")
      .setDescription(description.slice(0, 4000))
      .setFooter({ text: voteTrackerFooter(engine.getState().gameId) });

    if (open.length > 0) {
      embed.addFields({
        name: "On the block",
        value: formatBlockContestSummary(engine),
        inline: false,
      });
      embed.addFields({
        name: "Pass threshold",
        value: `**${needed}** yes needed (${living} alive)`,
        inline: true,
      });
    }

    if (resolved.length > 0) {
    embed.addFields({
      name: "Recently resolved",
      value: resolved
        .map((nomination) => {
          const nominee = engine.getPlayerById(nomination.nomineeId);
          return `#${nomination.order} ${nominee?.displayName ?? "?"} — ${nomination.status}`;
        })
        .join("\n")
        .slice(0, 1024),
    });
  }

  const visibility = day?.voteVisibility ?? "public";
  embed.addFields({
    name: "Visibility",
    value: visibility === "secret" ? "secret (players hidden; ST sees full rolls here)" : "public",
    inline: true,
  });

  const ghostStatus = engine.formatGhostVoteStatus();
  embed.addFields({
    name: "Ghost votes",
    value: ghostStatus.slice(0, 1024),
  });

  return embed;
}

export function buildStVoteTrackerComponents(
  engine: GameEngine,
): ActionRowBuilder<ButtonBuilder>[] {
  const open = engine.getState().day?.nominations.filter((n) => n.status === "open") ?? [];
  const gameId = engine.getState().gameId;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const nomination of open.slice(0, 4)) {
    const nominee = engine.getPlayerById(nomination.nomineeId);
    const labelBase = `#${nomination.order} ${nominee?.displayName ?? "nom"}`.slice(0, 40);
    const buttons: ButtonBuilder[] = [];

    if (nomination.votesLocked) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(announceBlockButtonCustomId(gameId, nomination.id))
          .setLabel("Announce & resolve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(unlockVotesButtonCustomId(gameId, nomination.id))
          .setLabel(`Unlock ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      );
    } else if (nomination.countHandIndex != null) {
      const hand = engine.getCountHandPlayer(nomination.id);
      const ghostHand = Boolean(hand && !hand.alive);
      const yesLabel = ghostHand
        ? "Yes & take ghost vote"
        : `Yes ${labelBase}`.slice(0, 80);
      buttons.push(
        new ButtonBuilder()
          .setCustomId(countYesButtonCustomId(gameId, nomination.id))
          .setLabel(yesLabel.slice(0, 80))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(countNoButtonCustomId(gameId, nomination.id))
          .setLabel(ghostHand ? "No (keep ghost)" : `No ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(cancelCountButtonCustomId(gameId, nomination.id))
          .setLabel("Cancel count")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(pingHandButtonCustomId(gameId, nomination.id))
          .setLabel("Ping hand")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(pingMissingButtonCustomId(gameId, nomination.id))
          .setLabel("Ping missing")
          .setStyle(ButtonStyle.Primary),
      );
    } else {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(startCountButtonCustomId(gameId, nomination.id))
          .setLabel(`Count ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(lockVotesButtonCustomId(gameId, nomination.id))
          .setLabel(`Lock all ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(pingMissingButtonCustomId(gameId, nomination.id))
          .setLabel("Ping missing")
          .setStyle(ButtonStyle.Secondary),
      );
    }

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(0, 5)));
  }
  return rows;
}

async function findVoteTrackerMessage(
  channel: AnyThreadChannel,
  gameId: string,
): Promise<Message | null> {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const message of pinned.values()) {
      if (parseVoteTrackerFooter(message.embeds[0]?.footer?.text) === gameId) {
        return message;
      }
    }
  }
  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (!recent) return null;
  for (const message of recent.values()) {
    if (parseVoteTrackerFooter(message.embeds[0]?.footer?.text) === gameId) {
      return message;
    }
  }
  return null;
}

async function resolveKibThreadForTracker(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  kibThreadId?: string | null,
): Promise<AnyThreadChannel | null> {
  let thread = await getStorytellerThread(guild, parentChannelId, { kibThreadId, gameId });
  if (!thread) {
    thread = await ensureStorytellerThread(guild, parentChannelId, gameId);
  }
  if (!thread) return null;

  if (thread.archived) {
    await thread.setArchived(false, "Posting ST vote tracker.").catch(() => undefined);
  }

  if (thread.id !== kibThreadId) {
    await prisma.game
      .update({
        where: { id: gameId },
        data: { kibThreadId: thread.id },
      })
      .catch(() => undefined);
  }

  return thread;
}

export async function upsertStVoteTracker(
  guild: Guild,
  parentChannelId: string,
  engine: GameEngine,
  kibThreadId?: string | null,
): Promise<Message | null> {
  const gameId = engine.getState().gameId;
  const thread = await resolveKibThreadForTracker(guild, parentChannelId, gameId, kibThreadId);
  if (!thread?.isTextBased()) {
    log("warn", "voteTracker.thread.missing", {
      gameId,
      parentChannelId,
      kibThreadId: kibThreadId ?? undefined,
      guildId: guild.id,
    });
    void reportError(
      "voteTracker.thread.missing",
      new Error("Could not find or create kib thread for vote tracker"),
      { gameId, parentChannelId, kibThreadId, guildId: guild.id },
    );
    return null;
  }

  const embed = buildStVoteTrackerEmbed(engine);
  const components = buildStVoteTrackerComponents(engine);
  const existing = await findVoteTrackerMessage(thread, gameId);

  if (existing) {
    try {
      await existing.edit({ embeds: [embed], components });
      return existing;
    } catch (error) {
      log("warn", "voteTracker.edit.failed", { gameId, threadId: thread.id, messageId: existing.id });
      void reportError("voteTracker.edit.failed", error, {
        gameId,
        threadId: thread.id,
        messageId: existing.id,
        guildId: guild.id,
      });
      // Fall through and try a fresh post.
    }
  }

  try {
    const message = await thread.send({ embeds: [embed], components });
    await message.pin().catch(() => undefined);
    return message;
  } catch (error) {
    log("warn", "voteTracker.send.failed", { gameId, threadId: thread.id });
    void reportError("voteTracker.send.failed", error, {
      gameId,
      threadId: thread.id,
      guildId: guild.id,
    });
    return null;
  }
}

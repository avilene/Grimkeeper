import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type AnyThreadChannel,
  type Guild,
  type Message,
} from "discord.js";
import type { GameEngine, NominationRecord } from "@grimkeeper/engine";

import { getStorytellerThread } from "./commands/command-context.js";
import { encodeIdPair, parseIdPair } from "./interaction-ids.js";

export const VOTE_TRACKER_FOOTER_PREFIX = "grimkeeper:vote-tracker:";
export const LOCK_VOTES_BUTTON_PREFIX = "gk:lock-votes:";
export const UNLOCK_VOTES_BUTTON_PREFIX = "gk:unlock-votes:";

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

export function parseLockVotesButtonCustomId(
  customId: string,
): { gameId: string; nominationId: string; lock: boolean } | null {
  const lock = customId.startsWith(LOCK_VOTES_BUTTON_PREFIX);
  const unlock = customId.startsWith(UNLOCK_VOTES_BUTTON_PREFIX);
  if (!lock && !unlock) return null;
  const rest = customId.slice(
    lock ? LOCK_VOTES_BUTTON_PREFIX.length : UNLOCK_VOTES_BUTTON_PREFIX.length,
  );
  const parsed = parseIdPair(rest);
  if (!parsed) return null;
  return {
    gameId: parsed.left,
    nominationId: parsed.right,
    lock,
  };
}

function nominationTrackerBlock(engine: GameEngine, nomination: NominationRecord): string {
  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const tally = engine.formatNominationTally(nomination.id, { revealSecret: true });
  const roll = engine.formatNominationVoteRoll(nomination.id);
  const lockLabel = nomination.votesLocked ? "🔒 **LOCKED**" : "🔓 Open for changes";
  const status =
    nomination.status === "open"
      ? lockLabel
      : nomination.status.replace("resolved_", "").replace("_", " ");

  return [
    `**#${nomination.order}** ${nominator?.displayName ?? "?"} → **${nominee?.displayName ?? "?"}** (${status})`,
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

  const embed = new EmbedBuilder()
    .setTitle("ST vote tracker")
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: voteTrackerFooter(engine.getState().gameId) });

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

  const buttons: ButtonBuilder[] = [];
  for (const nomination of open.slice(0, 10)) {
    const nominee = engine.getPlayerById(nomination.nomineeId);
    const labelBase = `#${nomination.order} ${nominee?.displayName ?? "nom"}`.slice(0, 60);
    if (nomination.votesLocked) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(unlockVotesButtonCustomId(gameId, nomination.id))
          .setLabel(`Unlock ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      );
    } else {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(lockVotesButtonCustomId(gameId, nomination.id))
          .setLabel(`Lock ${labelBase}`.slice(0, 80))
          .setStyle(ButtonStyle.Danger),
      );
    }
  }

  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
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

export async function upsertStVoteTracker(
  guild: Guild,
  parentChannelId: string,
  engine: GameEngine,
  kibThreadId?: string | null,
): Promise<Message | null> {
  const thread = await getStorytellerThread(guild, parentChannelId, { kibThreadId });
  if (!thread?.isTextBased()) return null;

  const embed = buildStVoteTrackerEmbed(engine);
  const components = buildStVoteTrackerComponents(engine);
  const existing = await findVoteTrackerMessage(thread, engine.getState().gameId);

  if (existing) {
    await existing.edit({ embeds: [embed], components }).catch(() => undefined);
    return existing;
  }

  const message = await thread.send({ embeds: [embed], components }).catch(() => null);
  if (message) {
    await message.pin().catch(() => undefined);
  }
  return message;
}

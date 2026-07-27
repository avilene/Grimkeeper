import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type APIEmbedField,
  type Guild,
  type Message,
  type NewsChannel,
  type PrivateThreadChannel,
  type PublicThreadChannel,
  type TextChannel,
} from "discord.js";
import {
  type GameEngine,
  type NominationRecord,
  type VoteVisibility,
} from "@grimkeeper/engine";

import { isDevMode } from "./dev.js";
import { formatMaskedDiscordLink, sanitizeDiscordLinkLabel } from "./discord-links.js";
import { encodeIdPair, parseIdPair } from "./interaction-ids.js";
import { log } from "./logger.js";
import { discordTimestamp } from "./reminder-message.js";

export const VOTE_BUTTON_PREFIX = "gk:vote:";
export const VOTE_MODAL_PREFIX = "gk:vote-modal:";

export function nominationFooterId(nominationId: string): string {
  return `nomid:${nominationId}`;
}

export function parseNominationIdFromFooter(footerText: string | null | undefined): string | null {
  if (!footerText?.startsWith("nomid:")) return null;
  return footerText.slice("nomid:".length) || null;
}

export function voteButtonCustomId(gameId: string, nominationId: string): string {
  return `${VOTE_BUTTON_PREFIX}${encodeIdPair(gameId, nominationId)}`;
}

export function parseVoteButtonCustomId(customId: string): { gameId: string; nominationId: string } | null {
  if (!customId.startsWith(VOTE_BUTTON_PREFIX)) return null;
  const parsed = parseIdPair(customId.slice(VOTE_BUTTON_PREFIX.length));
  if (!parsed) return null;
  return { gameId: parsed.left, nominationId: parsed.right };
}

export function voteModalCustomId(gameId: string, nominationId: string): string {
  // Unique per open so repeated Vote→modal cycles stay unambiguous under Discord's 100-char limit.
  const nonce = Date.now().toString(36);
  return `${VOTE_MODAL_PREFIX}${encodeIdPair(gameId, nominationId)}.${nonce}`.slice(0, 100);
}

export function parseVoteModalCustomId(customId: string): { gameId: string; nominationId: string } | null {
  if (!customId.startsWith(VOTE_MODAL_PREFIX)) return null;
  const parsed = parseIdPair(customId.slice(VOTE_MODAL_PREFIX.length));
  if (!parsed) return null;
  return { gameId: parsed.left, nominationId: parsed.right };
}

export function dayThreadName(dayNumber: number): string {
  return `Day ${dayNumber} — Town Square`.slice(0, 100);
}

/** Stable suffix so legacy Town Voting threads stay findable across games. */
export function townVoteThreadNameSuffix(gameId: string): string {
  return `· ${gameId.slice(0, 6)}`;
}

/** Fixed Town Voting thread name (resolved via `votingThreadId`, not the short game id). */
export function townVoteThreadName(_gameId?: string): string {
  return "Town Voting";
}

export function legacyTownVoteThreadName(gameId: string): string {
  return `Town Voting ${townVoteThreadNameSuffix(gameId)}`.slice(0, 100);
}

const TOWN_PHASE_CHANNEL_SUFFIX = /-((day|night)\d+|setup)$/i;

/** Strip a prior `-{day|night}N` or `-setup` suffix so renames keep the original base. */
export function townPhaseBaseChannelName(currentName: string): string {
  const trimmed = currentName.trim();
  const base = trimmed.replace(TOWN_PHASE_CHANNEL_SUFFIX, "");
  return (base || trimmed).slice(0, 100);
}

/**
 * Discord guild channel names are lowercase / hyphenated.
 * Example: `trouble-brewing-day1`, `trouble-brewing-night2`, `trouble-brewing-setup`.
 */
export function townPhaseParentChannelName(
  baseOrCurrentName: string,
  phase: "day" | "night" | "setup",
  phaseNumber = 0,
): string {
  const base = townPhaseBaseChannelName(baseOrCurrentName);
  if (phase === "setup") return `${base}-setup`.slice(0, 100);
  return `${base}-${phase}${phaseNumber}`.slice(0, 100);
}

export function parsePauseDurationMinutes(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(m|min|mins|minute|minutes)?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return null;
  return minutes;
}

function nominationStatusLabel(status: NominationRecord["status"], votesLocked?: boolean): string {
  switch (status) {
    case "open":
      return votesLocked ? "Open (votes locked)" : "Open";
    case "resolved_pass":
      return "Passed";
    case "resolved_fail":
      return "Failed";
    case "executed":
      return "Executed";
  }
}

/** e.g. `nomination of Alice on Bob` */
export function formatNominationPhrase(
  engine: GameEngine,
  nominationId: string,
  options?: { capitalize?: boolean },
): string {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return options?.capitalize ? "Nomination" : "nomination";
  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const phrase = `nomination of ${nominator?.displayName ?? "?"} on ${nominee?.displayName ?? "?"}`;
  if (!options?.capitalize) return phrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function nomineeDisplayName(engine: GameEngine, nomineeId: string): string {
  return engine.getPlayerById(nomineeId)?.displayName ?? "?";
}

/** Shared block summary for ST tracker, audit logs, and nomination embeds. */
export function formatBlockContestSummary(engine: GameEngine): string {
  const contest = engine.getBlockContest();
  const needed = engine.votesNeededOnTheBlock();
  const living = engine.countLivingPlayers();

  if (contest.kind === "empty") {
    return `No one on the block yet (**${needed}** yes needed, ${living} alive).`;
  }
  if (contest.kind === "sole") {
    const name = nomineeDisplayName(engine, contest.leader.nomineeId);
    return `**${name}** on the block (**${contest.leader.yesVotes}** yes) — ready to execute.`;
  }
  const names = contest.leaders.map((leader) => nomineeDisplayName(engine, leader.nomineeId)).join(", ");
  return `**Tie** between ${names} at **${contest.yesVotes}** yes — no execution until the tie breaks.`;
}

/** Per-nomination block / pass threshold for Town Voting embeds. */
export function formatNominationBlockField(
  engine: GameEngine,
  nomination: NominationRecord,
): string {
  const living = engine.countLivingPlayers();
  const needed = engine.votesNeededOnTheBlock();
  const yesVotes = engine.getEffectiveYesVotes(nomination.id);
  const contest = engine.getBlockContest();

  if (nomination.status === "executed") {
    return `Executed — had **${yesVotes}** yes when resolved.`;
  }

  if (nomination.status === "resolved_fail") {
    return `Did not pass — **${yesVotes}** yes (needed **${needed}**).`;
  }

  if (nomination.status === "open" && !nomination.votesLocked) {
    const lines = [`**${needed}** yes needed to pass (${living} alive)`];
    if (contest.kind === "sole" && contest.leader.nominationId !== nomination.id) {
      const leaderName = nomineeDisplayName(engine, contest.leader.nomineeId);
      const leaderYes = contest.leader.yesVotes;
      lines.push(
        `**${leaderName}** on the block (${leaderYes} yes). Need **${leaderYes + 1}** yes here to take it, or **${leaderYes}** to tie.`,
      );
    } else if (
      contest.kind === "tie" &&
      !contest.leaders.some((leader) => leader.nominationId === nomination.id)
    ) {
      const names = contest.leaders.map((leader) => nomineeDisplayName(engine, leader.nomineeId)).join(", ");
      lines.push(
        `Block tied: ${names} at **${contest.yesVotes}** yes. Need **${contest.yesVotes + 1}** yes here to take it.`,
      );
    }
    return lines.join("\n");
  }

  if (contest.kind === "sole" && contest.leader.nominationId === nomination.id) {
    return `**On the block for execution** — **${yesVotes}** yes (${needed} needed, ${living} alive).`;
  }
  if (contest.kind === "tie" && contest.leaders.some((leader) => leader.nominationId === nomination.id)) {
    const others = contest.leaders
      .filter((leader) => leader.nominationId !== nomination.id)
      .map((leader) => nomineeDisplayName(engine, leader.nomineeId));
    if (others.length > 0) {
      return `**Tied on the block** with ${others.join(", ")} at **${yesVotes}** yes — no execution until the tie breaks.`;
    }
    return `**Tied on the block** at **${yesVotes}** yes.`;
  }
  if (yesVotes >= needed) {
    const leaderNote =
      contest.kind === "sole"
        ? ` **${nomineeDisplayName(engine, contest.leader.nomineeId)}** on the block at **${contest.leader.yesVotes}** yes.`
        : contest.kind === "tie"
          ? ` Block tied at **${contest.yesVotes}** yes.`
          : "";
    return `Passed with **${yesVotes}** yes but **not** on the block.${leaderNote}`;
  }
  return `**${yesVotes}** yes (needed **${needed}** to pass).`;
}

/** @deprecated Prefer sanitizeDiscordLinkLabel from discord-links.js */
export function sanitizeMarkdownLinkLabel(text: string): string {
  const cleaned = sanitizeDiscordLinkLabel(text);
  return cleaned === "link" ? "nomination" : cleaned;
}

/**
 * Nomination phrase with an optional jump link for plain message content.
 * Uses a masked markdown link so Discord renders a real hyperlink (not a raw `(url)` suffix).
 */
export function formatNominationRef(
  engine: GameEngine,
  nominationId: string,
  messageUrl?: string | null,
  options?: { capitalize?: boolean },
): string {
  const phrase = formatNominationPhrase(engine, nominationId, options);
  if (!messageUrl) return phrase;
  return formatMaskedDiscordLink(phrase, messageUrl);
}

export function buildDayIntroEmbed(engine: GameEngine): EmbedBuilder {
  const state = engine.getState();
  const day = state.day;
  const visibility = day?.voteVisibility ?? "public";
  const playerLines = [
    "Use `/nominate` to accuse a player.",
    "Nominees may `/defend`.",
    "Vote with the **Vote** button, `/vote` (public), or `/privatevote`.",
  ];
  const stLines = ["Storyteller: use the kib **control panel**."];
  const devLines = isDevMode()
    ? [
        "",
        "**Dev mode:** `/dev fill`, `/dev clear`, `/dev setup`, `/dev reminders`.",
      ]
    : [];
  return new EmbedBuilder()
    .setTitle(`Day ${state.dayNumber} — Town Square`)
    .setDescription(
      [
        ...playerLines,
        `Vote visibility: **${visibility}**${visibility === "secret" ? " (Organ Grinder mode — tallies hidden from players)" : ""}.`,
        "",
        ...stLines,
        ...devLines,
      ].join("\n"),
    );
}

export function buildNominationEmbed(
  engine: GameEngine,
  nomination: NominationRecord,
  options?: { revealSecret?: boolean },
): EmbedBuilder {
  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const tallyText = engine.formatNominationTally(nomination.id, {
    ...options,
    ballot: "public",
  });
  const blockText = formatNominationBlockField(engine, nomination);
  const secret =
    engine.getState().day?.voteVisibility === "secret" && !options?.revealSecret;
  const fields: APIEmbedField[] = [
    {
      name: "Accusation",
      value: nomination.accusation || "—",
    },
    {
      name: "Defense",
      value: nomination.defense ?? "—",
    },
    {
      name: "Votes",
      value: tallyText,
    },
  ];

  if (!secret) {
    fields.push({
      name: "Vote order",
      value: engine
        .formatNominationVoteRoll(nomination.id, { audience: "public" })
        .slice(0, 1024),
    });
  }

  fields.push(
    {
      name: "On the block",
      value: blockText,
      inline: true,
    },
    {
      name: "Status",
      value: nominationStatusLabel(nomination.status, nomination.votesLocked),
      inline: true,
    },
    {
      name: "Order",
      value: `#${nomination.order}`,
      inline: true,
    },
  );

  if (nomination.voteDeadlineAt) {
    fields.push({
      name: "Votes close",
      value: discordTimestamp(new Date(nomination.voteDeadlineAt), "R"),
      inline: true,
    });
  }

  return new EmbedBuilder()
    .setTitle(formatNominationPhrase(engine, nomination.id, { capitalize: true }))
    .setDescription(
      `<@${nominator?.discordUserId ?? "unknown"}> nominates <@${nominee?.discordUserId ?? "unknown"}>`,
    )
    .addFields(fields)
    .setFooter({ text: nominationFooterId(nomination.id) });
}

export function buildVoteActionRow(
  gameId: string,
  nomination: NominationRecord,
): ActionRowBuilder<ButtonBuilder> | null {
  if (nomination.status !== "open") return null;
  if (nomination.votesLocked) return null;
  if (
    nomination.voteDeadlineAt &&
    Date.now() >= new Date(nomination.voteDeadlineAt).getTime()
  ) {
    return null;
  }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(voteButtonCustomId(gameId, nomination.id))
      .setLabel("Vote")
      .setStyle(ButtonStyle.Primary),
  );
}

export function formatVoteVisibility(visibility: VoteVisibility): string {
  return visibility === "secret" ? "secret (Organ Grinder)" : "public";
}

export type DayDiscussionChannel =
  | TextChannel
  | NewsChannel
  | PublicThreadChannel
  | PrivateThreadChannel;

/** Unarchive/unlock Town Voting (and similar) so sends/edits work when STs act from kib. */
export async function ensureDiscussionChannelSendable(
  channel: DayDiscussionChannel,
  reason: string,
): Promise<void> {
  if (!channel.isThread()) return;
  if (channel.archived) {
    await channel.setArchived(false, reason).catch(() => undefined);
  }
  if (channel.locked) {
    await channel.setLocked(false, reason).catch(() => undefined);
  }
  // Private threads require membership before send/fetch.
  if (channel.type === ChannelType.PrivateThread && "joinable" in channel) {
    const privateThread = channel as PrivateThreadChannel;
    if (privateThread.joinable) {
      await privateThread.join().catch(() => undefined);
    }
  }
}

export async function findNominationMessage(
  channel: DayDiscussionChannel,
  nominationId: string,
  options?: { limit?: number; maxPages?: number },
): Promise<Message | null> {
  const pageSize = options?.limit ?? 100;
  const maxPages = options?.maxPages ?? 1;
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const messages = await channel.messages
      .fetch(before ? { limit: pageSize, before } : { limit: pageSize })
      .catch(() => null);
    if (!messages || messages.size === 0) return null;

    for (const message of messages.values()) {
      const embed = message.embeds[0];
      const footerId = parseNominationIdFromFooter(embed?.footer?.text);
      if (footerId === nominationId) return message;
    }

    const oldest = messages.last();
    if (!oldest || messages.size < pageSize) return null;
    before = oldest.id;
  }
  return null;
}

export async function resolveNominationMessageUrl(
  channel: DayDiscussionChannel | null | undefined,
  nominationId: string,
): Promise<string | null> {
  if (!channel) return null;
  const message = await findNominationMessage(channel, nominationId);
  return message?.url ?? null;
}

export async function updateNominationMessage(
  engine: GameEngine,
  gameId: string,
  channel: DayDiscussionChannel,
  nominationId: string,
  options?: { revealSecret?: boolean },
): Promise<void> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return;

  await ensureDiscussionChannelSendable(channel, "Updating nomination embed.");

  const message =
    (await findNominationMessage(channel, nominationId)) ??
    null;
  if (!message) return;

  // Never reveal secret tallies on shared/public nomination embeds.
  const embedOptions =
    engine.getState().day?.voteVisibility === "secret"
      ? { revealSecret: false }
      : options;
  const embed = buildNominationEmbed(engine, nomination, embedOptions);
  const row = buildVoteActionRow(gameId, nomination);
  await message
    .edit({
      embeds: [embed],
      components: row ? [row] : [],
    })
    .catch((error: unknown) => {
      log("warn", "nomination.embed.edit.failed", {
        gameId,
        nominationId,
        channelId: channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function clearNominationMessageInChannel(
  channel: DayDiscussionChannel,
  nominationId: string,
): Promise<void> {
  const message = await findNominationMessage(channel, nominationId);
  if (!message) return;
  // Drop stale Vote buttons (e.g. old private-ballot embeds in ST threads).
  await message.edit({ components: [] }).catch(() => undefined);
}

export async function updateNominationMessagesInChannels(
  engine: GameEngine,
  gameId: string,
  channels: DayDiscussionChannel[],
  nominationId: string,
  options?: { revealSecret?: boolean },
): Promise<void> {
  const seen = new Set<string>();
  for (const channel of channels) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    await updateNominationMessage(engine, gameId, channel, nominationId, options);
  }
}

export async function postNominationToDayThread(
  engine: GameEngine,
  gameId: string,
  channel: DayDiscussionChannel,
  nominationId: string,
): Promise<Message | null> {
  return postNominationToChannel(engine, gameId, channel, nominationId);
}

export type PostNominationResult = {
  message: Message | null;
  error?: string;
};

export async function postNominationToChannel(
  engine: GameEngine,
  gameId: string,
  channel: DayDiscussionChannel,
  nominationId: string,
  options?: {
    /** @deprecated Personal ST nomination embeds are no longer posted. */
    privateBallot?: boolean;
    /** Role to ping when announcing in Town Voting (e.g. player role). */
    pingRoleId?: string | null;
  },
): Promise<Message | null> {
  const result = await postNominationToChannelDetailed(engine, gameId, channel, nominationId, options);
  return result.message;
}

/** Post a nomination embed; retries without role/user pings if Discord rejects mentions. */
export async function postNominationToChannelDetailed(
  engine: GameEngine,
  gameId: string,
  channel: DayDiscussionChannel,
  nominationId: string,
  options?: {
    privateBallot?: boolean;
    pingRoleId?: string | null;
    /** When true, post embed only (no Vote row) — e.g. kib ST read-through copies. */
    omitVoteButtons?: boolean;
    /** When true, skip the "**New nomination**" announcement content. */
    omitAnnouncement?: boolean;
  },
): Promise<PostNominationResult> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) {
    return { message: null, error: `Nomination \`${nominationId}\` not found in engine state.` };
  }

  await ensureDiscussionChannelSendable(channel, "Posting nomination to Town Voting.");

  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const embed = buildNominationEmbed(engine, nomination);
  if (options?.privateBallot) {
    embed.setDescription(
      `${embed.data.description ?? ""}\n\n_Private ballot — your vote confirmation stays in this thread._`,
    );
  }
  const row = options?.omitVoteButtons ? null : buildVoteActionRow(gameId, nomination);

  const mentionUsers = [nominator?.discordUserId, nominee?.discordUserId].filter(
    (id): id is string => Boolean(id),
  );
  const pingRoleId = options?.pingRoleId ?? null;
  const contentParts: string[] = [];
  if (pingRoleId) contentParts.push(`<@&${pingRoleId}>`);
  if (!options?.privateBallot && !options?.omitAnnouncement) {
    contentParts.push("**New nomination** — vote below, `/vote` (public), or `/privatevote`.");
  }
  const content = contentParts.length > 0 ? contentParts.join(" ") : undefined;
  const components = row ? [row] : [];

  try {
    const message = await channel.send({
      content,
      embeds: [embed],
      components,
      allowedMentions: {
        roles: pingRoleId ? [pingRoleId] : [],
        users: options?.omitAnnouncement ? [] : mentionUsers,
      },
    });
    return { message };
  } catch (firstError) {
    const firstMessage =
      firstError instanceof Error ? firstError.message : String(firstError);
    // Role/user mention permission failures are a common reason the whole send is rejected.
    try {
      const message = await channel.send({
        content:
          options?.privateBallot || options?.omitAnnouncement
            ? undefined
            : "**New nomination** — vote below, `/vote` (public), or `/privatevote`.",
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      });
      log("warn", "nomination.embed.post.retriedWithoutMentions", {
        gameId,
        nominationId,
        channelId: channel.id,
        firstError: firstMessage,
      });
      return { message };
    } catch (secondError) {
      const error =
        secondError instanceof Error ? secondError.message : String(secondError);
      log("warn", "nomination.embed.post.failed", {
        gameId,
        nominationId,
        channelId: channel.id,
        archived: channel.isThread() ? channel.archived : false,
        locked: channel.isThread() ? channel.locked : false,
        firstError: firstMessage,
        error,
      });
      return { message: null, error };
    }
  }
}

export async function addDayThreadMembers(
  guild: Guild,
  threadId: string,
  engine: GameEngine,
  options?: { includeDead?: boolean; stRoleId?: string | null },
): Promise<void> {
  const includeDead = options?.includeDead === true;
  const memberIds = new Set<string>();
  for (const player of engine.getState().players) {
    if (!includeDead && !player.alive) continue;
    if (player.isFake && !isDevMode()) continue;
    memberIds.add(player.discordUserId);
  }
  for (const stId of engine.getStorytellerDiscordIds()) {
    memberIds.add(stId);
  }
  // Include co-STs who hold the Discord role but are not in the engine ST list.
  if (options?.stRoleId) {
    for (const member of guild.members.cache.values()) {
      if (member.roles.cache.has(options.stRoleId)) {
        memberIds.add(member.id);
      }
    }
  }

  const thread = await guild.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread()) return;

  for (const userId of memberIds) {
    await thread.members.add(userId).catch(() => undefined);
  }
}

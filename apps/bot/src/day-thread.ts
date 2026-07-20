import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { encodeIdPair, parseIdPair } from "./interaction-ids.js";
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

/** Stable suffix so Town Voting threads stay findable across games. */
export function townVoteThreadNameSuffix(gameId: string): string {
  return `· ${gameId.slice(0, 6)}`;
}

/** Fixed Town Voting thread name (not renamed each phase). */
export function townVoteThreadName(gameId: string): string {
  return `Town Voting ${townVoteThreadNameSuffix(gameId)}`.slice(0, 100);
}

const TOWN_PHASE_CHANNEL_SUFFIX = /-(day|night)\d+$/i;

/** Strip a prior `-{day|night}N` suffix so renames keep the original base. */
export function townPhaseBaseChannelName(currentName: string): string {
  const trimmed = currentName.trim();
  const base = trimmed.replace(TOWN_PHASE_CHANNEL_SUFFIX, "");
  return (base || trimmed).slice(0, 100);
}

/**
 * Discord guild channel names are lowercase / hyphenated.
 * Example: `trouble-brewing-day1`, `trouble-brewing-night2`.
 */
export function townPhaseParentChannelName(
  baseOrCurrentName: string,
  phase: "day" | "night",
  phaseNumber: number,
): string {
  const base = townPhaseBaseChannelName(baseOrCurrentName);
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

/**
 * Make text safe as a Discord `[label](url)` label.
 * Strips `[bracket]` nickname tags and remaining `[]()` so names like `sharii [craboots!]` do not break the link.
 */
export function sanitizeMarkdownLinkLabel(text: string): string {
  const cleaned = text
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "nomination";
}

/** Wrap a nomination phrase in a Discord markdown jump link when a message URL is known. */
export function formatNominationRef(
  engine: GameEngine,
  nominationId: string,
  messageUrl?: string | null,
  options?: { capitalize?: boolean },
): string {
  const phrase = formatNominationPhrase(engine, nominationId, options);
  if (!messageUrl) return phrase;
  return `[${sanitizeMarkdownLinkLabel(phrase)}](${messageUrl})`;
}

export function buildDayIntroEmbed(engine: GameEngine): EmbedBuilder {
  const state = engine.getState();
  const day = state.day;
  const visibility = day?.voteVisibility ?? "public";
  const playerLines = [
    "Use `/nominate` to accuse a player.",
    "Nominees may `/defend`.",
    "Vote with the **Vote** button on each nomination or `/vote`.",
  ];
  const stLines = [
    "Storyteller: kib **control panel**, or `/st do` (`resolve-next`, `close-nominations`, `next-phase`, `execute`, `vote-visibility`, `nominate`, …).",
  ];
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
  const tallyText = engine.formatNominationTally(nomination.id, options);
  const living = engine.countLivingPlayers();
  const needed = engine.votesNeededOnTheBlock();
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
      value: engine.formatNominationVoteRoll(nomination.id).slice(0, 1024),
    });
  }

  fields.push(
    {
      name: "On the block",
      value: `**${needed}** yes needed (${living} alive)`,
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

export async function findNominationMessage(
  channel: DayDiscussionChannel,
  nominationId: string,
  limit = 100,
): Promise<Message | null> {
  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) return null;
  for (const message of messages.values()) {
    const embed = message.embeds[0];
    const footerId = parseNominationIdFromFooter(embed?.footer?.text);
    if (footerId === nominationId) return message;
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
    .catch(() => undefined);
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
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return null;

  const nominator = engine.getPlayerById(nomination.nominatorId);
  const nominee = engine.getPlayerById(nomination.nomineeId);
  const embed = buildNominationEmbed(engine, nomination);
  if (options?.privateBallot) {
    embed.setDescription(
      `${embed.data.description ?? ""}\n\n_Private ballot — your vote confirmation stays in this thread._`,
    );
  }
  const row = buildVoteActionRow(gameId, nomination);

  const mentionUsers = [nominator?.discordUserId, nominee?.discordUserId].filter(
    (id): id is string => Boolean(id),
  );
  const pingRoleId = options?.pingRoleId ?? null;
  const contentParts: string[] = [];
  if (pingRoleId) contentParts.push(`<@&${pingRoleId}>`);
  if (!options?.privateBallot) contentParts.push("**New nomination** — vote below or with `/vote` in your ST thread.");

  return channel
    .send({
      content: contentParts.length > 0 ? contentParts.join(" ") : undefined,
      embeds: [embed],
      components: row ? [row] : [],
      allowedMentions: {
        roles: pingRoleId ? [pingRoleId] : [],
        users: mentionUsers,
      },
    })
    .catch(() => null);
}

export async function addDayThreadMembers(
  guild: Guild,
  threadId: string,
  engine: GameEngine,
): Promise<void> {
  const memberIds = new Set<string>();
  for (const player of engine.getState().players) {
    if (player.alive && !player.isFake) {
      memberIds.add(player.discordUserId);
    } else if (player.alive && player.isFake && isDevMode()) {
      memberIds.add(player.discordUserId);
    }
  }
  for (const stId of engine.getStorytellerDiscordIds()) {
    memberIds.add(stId);
  }

  const thread = await guild.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread()) return;

  for (const userId of memberIds) {
    await thread.members.add(userId).catch(() => undefined);
  }
}

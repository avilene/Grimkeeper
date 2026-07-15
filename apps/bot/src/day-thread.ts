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
  return `${VOTE_BUTTON_PREFIX}${gameId}:${nominationId}`;
}

export function parseVoteButtonCustomId(customId: string): { gameId: string; nominationId: string } | null {
  if (!customId.startsWith(VOTE_BUTTON_PREFIX)) return null;
  const rest = customId.slice(VOTE_BUTTON_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  return {
    gameId: rest.slice(0, separator),
    nominationId: rest.slice(separator + 1),
  };
}

export function voteModalCustomId(gameId: string, nominationId: string): string {
  return `${VOTE_MODAL_PREFIX}${gameId}:${nominationId}`;
}

export function parseVoteModalCustomId(customId: string): { gameId: string; nominationId: string } | null {
  if (!customId.startsWith(VOTE_MODAL_PREFIX)) return null;
  const rest = customId.slice(VOTE_MODAL_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  return {
    gameId: rest.slice(0, separator),
    nominationId: rest.slice(separator + 1),
  };
}

export function dayThreadName(dayNumber: number): string {
  return `Day ${dayNumber} — Town Square`.slice(0, 100);
}

export function townVoteThreadName(): string {
  return "Town Voting";
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

export function buildDayIntroEmbed(engine: GameEngine): EmbedBuilder {
  const state = engine.getState();
  const day = state.day;
  const visibility = day?.voteVisibility ?? "public";
  const devLines = isDevMode()
    ? [
        "",
        "**Dev mode:** `/dev nominate`, `/dev set-vote`, `/dev kill`, `/dev day-status`.",
      ]
    : [];
  return new EmbedBuilder()
    .setTitle(`Day ${state.dayNumber} — Town Square`)
    .setDescription(
      [
        "Use `/game nominate` to accuse a player.",
        "Nominees may `/game defend`.",
        "Vote with the **Vote** button on each nomination or `/game vote`.",
        `Vote visibility: **${visibility}**${visibility === "secret" ? " (Organ Grinder mode — tallies hidden from players)" : ""}.`,
        "",
        "Storyteller: `/st pause-nominations`, `/st vote-visibility`, `/st close-nominations`, `/st resolve-next`, `/st execute`, `/st set-vote`, `/st remind`.",
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
  ];

  if (nomination.voteDeadlineAt) {
    fields.push({
      name: "Votes close",
      value: discordTimestamp(new Date(nomination.voteDeadlineAt), "R"),
      inline: true,
    });
  }

  return new EmbedBuilder()
    .setTitle(
      `Nomination #${nomination.order}: ${nominee?.displayName ?? "Unknown"}`,
    )
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
  options?: { privateBallot?: boolean },
): Promise<Message | null> {
  const nomination = engine.getNominationById(nominationId);
  if (!nomination) return null;

  const embed = buildNominationEmbed(engine, nomination);
  if (options?.privateBallot) {
    embed.setDescription(
      `${embed.data.description ?? ""}\n\n_Private ballot — your vote confirmation stays in this thread._`,
    );
  }
  const row = buildVoteActionRow(gameId, nomination);
  return channel
    .send({
      embeds: [embed],
      components: row ? [row] : [],
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

import { EmbedBuilder, type Guild, type Message, type TextBasedChannel } from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

const STATUS_FOOTER_PREFIX = "grimkeeper:status:";

export function gameStatusFooter(gameId: string): string {
  return `${STATUS_FOOTER_PREFIX}${gameId}`;
}

export function buildAliveDeadLines(engine: GameEngine): { alive: string; dead: string; daySummary: string } {
  const state = engine.getState();
  const alivePlayers = state.players.filter((player) => player.alive);
  const deadPlayers = state.players.filter((player) => !player.alive);

  const formatPlayer = (player: (typeof state.players)[number]) =>
    player.isFake ? player.displayName : `<@${player.discordUserId}>`;

  const formatDeadPlayer = (player: (typeof state.players)[number]) => {
    const ghost = player.ghostVoteUsed ? "ghost **used**" : "ghost **available**";
    return `• ${formatPlayer(player)} — ${ghost}`;
  };

  const alive =
    alivePlayers.length > 0
      ? alivePlayers.map((player) => `• ${formatPlayer(player)}`).join("\n")
      : "—";
  const dead =
    deadPlayers.length > 0
      ? deadPlayers.map((player) => formatDeadPlayer(player)).join("\n")
      : "—";

  let daySummary = "Not in day phase.";
  if (state.phase === "setup") {
    daySummary = "**Setup** · Nominations closed until Day 1";
  } else if (state.phase === "night") {
    daySummary = `Night **${state.nightNumber}** · Nominations: **closed**`;
  } else if (state.phase === "day" && state.day) {
    const openNominations = state.day.nominations.filter((nomination) => nomination.status === "open").length;
    const ghostsAvailable = deadPlayers.filter((player) => !player.ghostVoteUsed).length;
    daySummary = [
      `Day **${state.dayNumber}**`,
      `Nominations: **${state.day.nominations.length}** (${openNominations} open)`,
      `Voting: **${state.day.nominationsOpen ? "open" : "closed"}**`,
      `Execution today: **${state.day.executionUsed ? "yes" : "no"}**`,
      `Ghost votes left: **${ghostsAvailable}**`,
    ].join(" · ");
  }

  return { alive, dead, daySummary };
}

export function buildGameStatusEmbed(engine: GameEngine): EmbedBuilder {
  const { alive, dead, daySummary } = buildAliveDeadLines(engine);

  return new EmbedBuilder()
    .setTitle("Town status")
    .setDescription(daySummary)
    .addFields(
      { name: `Alive (${engine.getState().players.filter((p) => p.alive).length})`, value: alive },
      { name: `Dead (${engine.getState().players.filter((p) => !p.alive).length})`, value: dead },
    )
    .setFooter({ text: gameStatusFooter(engine.getState().gameId) });
}

async function findStatusMessage(
  channel: TextBasedChannel,
  gameId: string,
): Promise<Message | null> {
  const footer = gameStatusFooter(gameId);

  const pins = await channel.messages.fetchPinned().catch(() => null);
  if (pins) {
    for (const message of pins.values()) {
      if (message.embeds[0]?.footer?.text === footer) {
        return message;
      }
    }
  }

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (recent) {
    for (const message of recent.values()) {
      if (message.embeds[0]?.footer?.text === footer) {
        return message;
      }
    }
  }

  return null;
}

export async function upsertPinnedGameStatus(
  guild: Guild,
  channelId: string,
  engine: GameEngine,
  options?: { createIfMissing?: boolean },
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    return;
  }

  const embed = buildGameStatusEmbed(engine);
  const existing = await findStatusMessage(channel, engine.getState().gameId);

  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => undefined);
    if (!existing.pinned) {
      await existing.pin().catch(() => undefined);
    }
    return;
  }

  if (options?.createIfMissing === false) {
    return;
  }

  const message = await channel.send({ embeds: [embed] }).catch(() => null);
  if (!message) return;
  await message.pin().catch(() => undefined);
}

export async function refreshGameStatusForEngine(engine: GameEngine): Promise<void> {
  const { getBotClient } = await import("./discord-client.js");
  const client = getBotClient();
  if (!client) return;

  const state = engine.getState();
  const guild = await client.guilds.fetch(state.guildId).catch(() => null);
  if (!guild) return;

  const channelId = state.day?.discordThreadId ?? state.channelId;
  await upsertPinnedGameStatus(guild, channelId, engine, {
    createIfMissing: state.phase === "day",
  });
}

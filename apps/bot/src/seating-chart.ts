import { EmbedBuilder, type Guild, type Message, type TextBasedChannel } from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

const SEATING_FOOTER_PREFIX = "grimkeeper:seating:";

export function seatingChartFooter(gameId: string): string {
  return `${SEATING_FOOTER_PREFIX}${gameId}`;
}

export function buildSeatingChartLines(engine: GameEngine): string[] {
  const state = engine.getState();
  const seatCount = state.players.length;
  const lines: string[] = [];

  for (let seat = 1; seat <= seatCount; seat++) {
    const occupant = state.players.find((player) => player.seat === seat);
    if (!occupant) {
      lines.push(`**Seat ${seat}:** —`);
    } else if (occupant.isFake) {
      lines.push(`**Seat ${seat}:** ${occupant.displayName} *(fake)*`);
    } else {
      lines.push(`**Seat ${seat}:** <@${occupant.discordUserId}>`);
    }
  }

  const unseated = state.players.filter((player) => player.seat === null);
  if (unseated.length > 0) {
    const names = unseated.map((player) =>
      player.isFake ? player.displayName : `<@${player.discordUserId}>`,
    );
    lines.push("", `**Unseated:** ${names.join(", ")}`);
  }

  return lines;
}

export function buildSeatingEmbed(engine: GameEngine): EmbedBuilder {
  const state = engine.getState();
  const lines = buildSeatingChartLines(engine);

  let status: string;
  if (state.phase === "lobby") {
    status = "Seating opens after `/st start`.";
  } else if (state.seatsOpen) {
    status = "Seat selection is **open** — pick with `/game seat`.";
  } else if (state.phase === "setup") {
    status = engine.allPlayersSeated()
      ? "Seat selection is **closed**. Everyone is seated."
      : "Seat selection is **closed**. Some players are still unseated.";
  } else {
    status = "Seating locked for this game.";
  }

  return new EmbedBuilder()
    .setTitle("Seating chart")
    .setDescription(`${status}\n\n${lines.join("\n")}`)
    .setFooter({ text: seatingChartFooter(state.gameId) });
}

async function findSeatingMessage(
  channel: TextBasedChannel,
  gameId: string,
): Promise<Message | null> {
  const footer = seatingChartFooter(gameId);

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

export async function upsertPinnedSeatingChart(
  guild: Guild,
  channelId: string,
  engine: GameEngine,
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    return;
  }

  const embed = buildSeatingEmbed(engine);
  const existing = await findSeatingMessage(channel, engine.getState().gameId);

  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => undefined);
    if (!existing.pinned) {
      await existing.pin().catch(() => undefined);
    }
    return;
  }

  const message = await channel.send({ embeds: [embed] }).catch(() => null);
  if (!message) return;
  await message.pin().catch(() => undefined);
}

import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { getPlayerStats } from "@grimkeeper/database";

import { replyOrEditInteraction } from "./command-context.js";

function formatWinRate(rate: number | null): string {
  if (rate == null) return "n/a";
  return `${(rate * 100).toFixed(1)}%`;
}

function buildStatsEmbed(
  displayName: string,
  discordUserId: string,
  stats: Awaited<ReturnType<typeof getPlayerStats>>,
): EmbedBuilder {
  const alignmentBits = [
    stats.goodGames ? `${stats.goodGames} good` : null,
    stats.evilGames ? `${stats.evilGames} evil` : null,
    stats.travelerGames ? `${stats.travelerGames} traveler` : null,
    stats.unalignedGames ? `${stats.unalignedGames} unaligned` : null,
  ].filter(Boolean);

  const characters =
    stats.topCharacters.length === 0
      ? "_No characters recorded._"
      : stats.topCharacters
          .map((entry, index) => `${index + 1}. **${entry.name}** ×${entry.count}`)
          .join("\n");

  return new EmbedBuilder()
    .setTitle(`Stats — ${displayName}`)
    .setDescription(`Guild-scoped results for <@${discordUserId}> (ended games with a winner).`)
    .addFields(
      {
        name: "Record",
        value: [
          `**Games:** ${stats.gamesPlayed}`,
          `**Wins / losses:** ${stats.wins} / ${stats.losses}`,
          `**Win rate:** ${formatWinRate(stats.winRate)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Alignment",
        value: alignmentBits.length > 0 ? alignmentBits.join(" · ") : "_none_",
        inline: true,
      },
      {
        name: "Most played",
        value: characters,
      },
    )
    .setFooter({
      text: "Travelers and unaligned seats count in games played but not win rate.",
    });
}

@Discord()
export class StatsCommands {
  @Slash({
    name: "stats",
    description: "Show win rate and most-played characters in this server",
  })
  async stats(
    @SlashOption({
      name: "user",
      description: "Player to look up (defaults to you)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Stats are available in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = user ?? interaction.user;
    const stats = await getPlayerStats(interaction.guildId, target.id);
    const displayName =
      interaction.guild?.members.cache.get(target.id)?.displayName ??
      target.displayName ??
      target.username;

    await replyOrEditInteraction(interaction, {
      embeds: [buildStatsEmbed(displayName, target.id, stats)],
    });
  }
}

import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import {
  listActiveGamesForGuild,
  upsertPlayerAlias,
  resolvePlayerAlias,
} from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import { hasAdminRole } from "../access.js";
import { sanitizeMarkdownLinkLabel } from "../day-thread.js";
import {
  loadEngine,
  persistEvents,
  replyOrEditInteraction,
  requireDayPlayAccess,
} from "./command-context.js";

/** Default in-game label from a Discord display name (strips [tags] / (tags)). */
export function defaultPlayerAlias(discordDisplayName: string): string {
  return sanitizeMarkdownLinkLabel(discordDisplayName);
}

/**
 * Resolve guild alias for a Discord user, creating a default from their Discord name if unset.
 */
export async function resolveOrCreatePlayerAlias(
  guildId: string,
  discordUserId: string,
  discordDisplayName: string,
): Promise<string> {
  const existing = await resolvePlayerAlias(guildId, discordUserId);
  if (existing) return existing;
  const alias = defaultPlayerAlias(discordDisplayName);
  return upsertPlayerAlias(guildId, discordUserId, alias);
}

async function canEditAliasFor(
  interaction: CommandInteraction,
  targetUserId: string,
): Promise<boolean> {
  if (interaction.user.id === targetUserId) return true;
  if (await hasAdminRole(interaction)) return true;
  if (!interaction.guildId) return false;

  const games = await listActiveGamesForGuild(interaction.guildId);
  for (const game of games) {
    const engine = await loadEngine(game.id);
    if (engine.isStoryteller(interaction.user.id)) return true;
  }
  return false;
}

async function syncAliasIntoActiveGames(
  guildId: string,
  discordUserId: string,
  alias: string,
): Promise<number> {
  const games = await listActiveGamesForGuild(guildId);
  let updated = 0;
  for (const game of games) {
    const engine = await loadEngine(game.id);
    if (engine.getState().phase === "ended") continue;
    const player = engine.getPlayerByDiscordId(discordUserId);
    if (!player) continue;
    const events = engine.handle({
      kind: GameCommandKind.SetPlayerDisplayName,
      gameId: game.id,
      playerId: player.id,
      displayName: alias,
    });
    if (events.length === 0) continue;
    await persistEvents(engine, events);
    updated += 1;
  }
  return updated;
}

@Discord()
export class AliasCommands {
  @Slash({
    name: "alias",
    description: "Set your in-game display name (shared across games in this server)",
  })
  async alias(
    @SlashOption({
      name: "name",
      description: "Alias to show on nominations, votes, and roster",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    name: string,
    @SlashOption({
      name: "user",
      description: "Player to update (defaults to you; ST/admin only for others)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Aliases are set in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = user ?? interaction.user;
    if (!(await canEditAliasFor(interaction, target.id))) {
      await replyOrEditInteraction(interaction, {
        content: "Only that player, a storyteller, or an admin can set this alias.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      await replyOrEditInteraction(interaction, {
        content: "Alias cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (trimmed.length > 100) {
      await replyOrEditInteraction(interaction, {
        content: "Alias must be 100 characters or fewer.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const alias = await upsertPlayerAlias(interaction.guildId, target.id, trimmed);
    const synced = await syncAliasIntoActiveGames(interaction.guildId, target.id, alias);
    const syncNote =
      synced > 0
        ? ` Updated **${synced}** active game${synced === 1 ? "" : "s"}.`
        : "";

    await replyOrEditInteraction(interaction, {
      content:
        target.id === interaction.user.id
          ? `Your alias is now **${alias}**.${syncNote}`
          : `Alias for <@${target.id}> is now **${alias}**.${syncNote}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { GameCommandKind } from "@grimkeeper/engine";

import { minPlayersForMode } from "../bot-mode.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  cleanupGameRoles,
  createPlayerStThreads,
  getGameRoles,
  getStorytellerThread,
  loadEngine,
  persistEvents,
  removeRoleFromUser,
  replyEngineError,
  replyOrEditInteraction,
  requireCommandAccess,
  requireStorytellerGame,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StCommandsMinimal {
  @Slash({ name: "start", description: "Start the game and create private ST threads for each player" })
  async start(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.StartGame,
        gameId: game.id,
        minPlayers: minPlayersForMode(),
      });

      await persistEvents(engine, events);

      const guild = interaction.guild;
      const threadSummary = guild
        ? await createPlayerStThreads(interaction, game, engine)
        : { created: 0, failed: 0 };

      const threadHint =
        threadSummary.created > 0 || threadSummary.failed > 0
          ? ` Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.`
          : "";

      await replyOrEditInteraction(interaction, {
        content: `Game started.${threadHint}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "end", description: "End the game" })
  async end(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.EndGame,
        gameId: game.id,
        winner: "good",
        reason: "Game ended by storyteller",
      });
      await persistEvents(engine, events);

      if (GAME_DISCORD_ROLES_ENABLED) {
        await cleanupGameRoles(guild, game.channelId);
      }

      const cleanupHint = GAME_DISCORD_ROLES_ENABLED ? " Game roles cleaned up." : "";
      await interaction.reply({
        content: `Game ended.${cleanupHint}`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "add-spectator", description: "Assign spectator role and add user to the kib thread" })
  async addSpectator(
    @SlashOption({
      name: "user",
      description: "User to assign as spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    const gameRoles = await getGameRoles(guild, game.channelId);
    if (!gameRoles) {
      await interaction.reply({
        content: "Could not find game roles for this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const isPlayer = engine.getPlayerByDiscordId(user.id);
    const isSt = engine.isStoryteller(user.id);
    if (isPlayer || isSt) {
      await interaction.reply({
        content: "That user is already a player or storyteller in this game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addRoleToUser(guild, user.id, gameRoles.spectatorRole.id);

    const thread = await getStorytellerThread(guild, game.channelId);
    if (thread) {
      await thread.members.add(user.id).catch(() => undefined);
    }

    const threadHint = thread ? ` Added to <#${thread.id}>.` : " Could not add to kib thread.";
    await interaction.reply({
      content: `Assigned spectator role to <@${user.id}>.${threadHint}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "remove-spectator", description: "Remove spectator role from a user" })
  async removeSpectator(
    @SlashOption({
      name: "user",
      description: "User to remove as spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    const gameRoles = await getGameRoles(guild, game.channelId);
    if (!gameRoles) {
      await interaction.reply({
        content: "Could not find game roles for this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await removeRoleFromUser(guild, user.id, gameRoles.spectatorRole.id);
    await interaction.reply({
      content: `Removed spectator role from <@${user.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

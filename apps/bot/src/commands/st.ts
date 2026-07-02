import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getActiveGameForGuild } from "@grimkeeper/database";
import {
  GameCommandKind,
  dealRolesFromScript,
  findScriptRole,
  getScriptCompositionText,
} from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  cleanupGameRoles,
  deliverRolesToPlayers,
  ensureGameThreads,
  getStorytellerThread,
  loadEngine,
  minPlayers,
  openStorytellerThread,
  persistEvents,
  postSetupChecklist,
  postToStorytellerThread,
  postToTownChannel,
  replyEngineError,
  requireCommandAccess,
  requireStorytellerGame,
  syncGameProjection,
  getGameRoles,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StCommands {
  @Slash({ name: "add-spectator", description: "Add a user to the storyteller thread" })
  async addSpectator(
    @SlashOption({
      name: "user",
      description: "User to add to the storyteller thread",
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

    const thread = await getStorytellerThread(guild, game.channelId);
    if (!thread) {
      await interaction.reply({
        content: "Could not find a storyteller thread for this game channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await thread.members.add(user.id).catch(() => undefined);
    await interaction.reply({
      content: `Added <@${user.id}> to <#${thread.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "promote-st", description: "Promote a user to storyteller for this game" })
  async promoteSt(
    @SlashOption({
      name: "user",
      description: "User to promote",
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

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.PromoteStoryteller,
        gameId: game.id,
        discordUserId: user.id,
      });
      await persistEvents(engine, events);

      const thread = await getStorytellerThread(guild, game.channelId);
      if (thread) {
        await thread.members.add(user.id).catch(() => undefined);
      }

      if (GAME_DISCORD_ROLES_ENABLED) {
        const gameRoles = await getGameRoles(guild, game.channelId);
        if (gameRoles) {
          await addRoleToUser(guild, user.id, gameRoles.stRole.id);
        }
      }

      const threadHint = thread ? " Added to the storyteller thread." : "";
      await interaction.reply({
        content: `Promoted <@${user.id}> to storyteller.${threadHint}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "ping-players", description: "Ping all players for this game" })
  async pingPlayers(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    if (GAME_DISCORD_ROLES_ENABLED) {
      const gameRoles = await getGameRoles(interaction.guild, game.channelId);
      if (!gameRoles) {
        await interaction.reply({ content: "Could not find game roles.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: `<@&${gameRoles.playersRole.id}>` });
      return;
    }

    const engine = await loadEngine(game.id);
    const mentions = engine
      .getState()
      .players.filter((player) => !player.isFake)
      .map((player) => `<@${player.discordUserId}>`)
      .join(" ");
    await interaction.reply({ content: mentions || "No players to ping." });
  }

  @Slash({ name: "ping-st", description: "Ping storytellers for this game" })
  async pingSt(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
      return;
    }

    const engine = await loadEngine(game.id);
    const mentions = engine
      .getStorytellerDiscordIds()
      .map((discordUserId) => `<@${discordUserId}>`)
      .join(" ");
    await interaction.reply({
      content: mentions || "No storytellers found.",
    });
  }

  @Slash({ name: "start", description: "Move to grimoire setup once the lobby is ready" })
  async start(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.StartGame,
        gameId: game.id,
        minPlayers: minPlayers(),
      });

      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const script = engine.getState().script;
      const guild = interaction.guild;
      const threadSummary =
        guild ? await ensureGameThreads(interaction, guild, game, engine) : null;

      const threadHint = threadSummary
        ? ` ST thread: ${threadSummary.stThread ? `<#${threadSummary.stThread.id}>` : "unavailable"}. Player threads: ${threadSummary.playerThreadsCreated} created${threadSummary.playerThreadsFailed > 0 ? `, ${threadSummary.playerThreadsFailed} failed` : ""}.`
        : "";

      if (guild && threadSummary?.stThread) {
        await postSetupChecklist(threadSummary.stThread, engine.getState().players.length);
      }

      await interaction.reply({
        content:
          `Setup started for **${script?.name ?? "your script"}**.` +
          threadHint +
          " See the storyteller thread for setup steps. Open seat selection with `/st open-seats` when ready.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "grim-setup", description: "Show script and composition for grimoire setup" })
  async grimSetup(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    if (state.phase !== "setup") {
      await interaction.reply({
        content: "Run `/st start` first to enter grimoire setup.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const script = state.script;
    if (!script) {
      await interaction.reply({ content: "This game has no script configured.", flags: MessageFlags.Ephemeral });
      return;
    }

    const playerCount = state.players.length;
    const compositionText = getScriptCompositionText(playerCount, { devMode: isDevMode() });
    const roleList = script.roles.map((role) => `**${role.name}** (${role.type})`).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`Grimoire setup — ${script.name}`)
      .setDescription(
        `Assign **${playerCount}** roles from this script.\nComposition: ${compositionText}\n\nUse \`/st assign\` to place roles manually, \`/st deal\` to randomize, then \`/st begin-night\` when ready.`,
      )
      .addFields({ name: `Script roles (${script.roles.length})`, value: roleList.slice(0, 4000) });

    const guild = interaction.guild;
    if (guild) {
      const thread = await getStorytellerThread(guild, game.channelId);
      if (thread) {
        await thread.send({ embeds: [embed] }).catch(() => undefined);
      }
    }

    await interaction.reply({
      content: "Posted grimoire setup details to the storyteller thread.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "open-seats", description: "Open seat selection for players (storyteller)" })
  async openSeats(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.OpenSeats, gameId: game.id });
      await persistEvents(engine, events);

      const playerCount = engine.getState().players.length;
      const stEmbed = new EmbedBuilder()
        .setTitle("Seat selection open")
        .setDescription(
          `Players can now run \`/game seat\` to claim seats **1–${playerCount}**.\n\nWhen everyone is seated, run \`/st close-seats\` to lock seating and announce it in town.`,
        )
        .addFields({ name: "Current seating", value: engine.getSeatingChart().join("\n") });

      const townEmbed = new EmbedBuilder()
        .setTitle("Pick your seat")
        .setDescription(
          `The storyteller has opened seat selection. Players, use \`/game seat\` to choose a seat **(1–${playerCount})** in this channel.`,
        );

      await postToStorytellerThread(guild, game.channelId, { embeds: [stEmbed] });
      await postToTownChannel(guild, game.channelId, { embeds: [townEmbed] });

      await interaction.reply({
        content: "Seat selection is open. Players have been notified in town.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "close-seats", description: "Close seat selection and announce seating in town" })
  async closeSeats(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.CloseSeats, gameId: game.id });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const seatingLines = engine.getSeatingChart();
      const allSeated = engine.allPlayersSeated();
      const townEmbed = new EmbedBuilder()
        .setTitle("Seating")
        .setDescription(seatingLines.join("\n"))
        .setFooter({
          text: allSeated
            ? "Seat selection is closed."
            : "Seat selection is closed. Some players are still unseated.",
        });

      await postToStorytellerThread(guild, game.channelId, { embeds: [townEmbed] });
      await postToTownChannel(guild, game.channelId, { embeds: [townEmbed] });

      await interaction.reply({
        content: allSeated
          ? "Seat selection closed. Seating announced in town."
          : "Seat selection closed, but some players are still unseated.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "deal", description: "Randomly deal roles from the script and begin night 1" })
  async deal(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const state = engine.getState();
      const script = state.script;
      if (!script) {
        await interaction.reply({ content: "This game has no script configured.", flags: MessageFlags.Ephemeral });
        return;
      }

      const roleIds = dealRolesFromScript(script.roles, state.players.length, { devMode: isDevMode() });
      const events = engine.handle({
        kind: GameCommandKind.DealRoles,
        gameId: game.id,
        roleAssignments: state.players.map((player, index) => ({
          playerId: player.id,
          roleId: roleIds[index]!,
        })),
      });

      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const roleLines = await deliverRolesToPlayers(interaction, game, engine);
      const replyContent = isDevMode()
        ? "Roles dealt. Night 1 has begun.\n\n" + roleLines.join("\n")
        : "Roles dealt privately. Night 1 has begun.";

      await interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "assign", description: "Assign a script role to a player during setup" })
  async assign(
    @SlashOption({
      name: "player",
      description: "Player to assign a role to",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    @SlashOption({
      name: "role",
      description: "Role name or id from the script",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    roleQuery: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const state = engine.getState();
      const script = state.script;
      if (!script) {
        await interaction.reply({ content: "This game has no script configured.", flags: MessageFlags.Ephemeral });
        return;
      }

      const targetPlayer = state.players.find((candidate) => candidate.discordUserId === player.id);
      if (!targetPlayer) {
        await interaction.reply({ content: "That user is not in this game.", flags: MessageFlags.Ephemeral });
        return;
      }

      const role = findScriptRole(script, roleQuery);
      if (!role) {
        await interaction.reply({
          content: `Could not find "${roleQuery}" on **${script.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.AssignRole,
        gameId: game.id,
        playerId: targetPlayer.id,
        roleId: role.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      await interaction.reply({
        content: `Assigned **${role.name}** to ${targetPlayer.displayName}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "begin-night", description: "Lock in manual grimoire assignments and start night 1" })
  async beginNight(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.BeginNight,
        gameId: game.id,
      });

      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const roleLines = await deliverRolesToPlayers(interaction, game, engine);
      const replyContent = isDevMode()
        ? "Night 1 has begun.\n\n" + roleLines.join("\n")
        : "Grimoire locked in. Roles sent privately. Night 1 has begun.";

      await interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "night", description: "Advance to the next night" })
  async night(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.AdvancePhase, gameId: game.id, targetPhase: "night" });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      await interaction.reply({ content: `Night ${engine.getState().nightNumber} started.`, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "day", description: "Advance to the next day" })
  async day(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.AdvancePhase, gameId: game.id, targetPhase: "day" });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      await interaction.reply({
        content: `Day ${engine.getState().dayNumber} started. Players can nominate with \`/game nominate\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "grim-reveal", description: "Show end-of-game role reveal" })
  async grimReveal(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const lines = engine.getGrimReveal();
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Grim Reveal")
          .setDescription(lines.join("\n")),
      ],
    });
  }

  @Slash({ name: "end", description: "End the game and record the winner" })
  async end(
    @SlashOption({
      name: "winner",
      description: "Which team won",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    winner: "good" | "evil",
    @SlashOption({
      name: "reason",
      description: "Why the game ended",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    reason: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.EndGame, gameId: game.id, winner, reason });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      if (GAME_DISCORD_ROLES_ENABLED) {
        await cleanupGameRoles(guild, game.channelId);
      }
      const thread = await openStorytellerThread(
        guild,
        game.channelId,
        [
          ...engine.getStorytellerDiscordIds(),
          ...engine
            .getState()
            .players.filter((player) => !player.isFake)
            .map((player) => player.discordUserId),
        ],
      );
      const cleanupHint = GAME_DISCORD_ROLES_ENABLED ? " (game roles cleaned up)" : "";
      const threadHint = thread ? ` Post-game discussion: <#${thread.id}>.` : "";
      if (thread) {
        await postToTownChannel(guild, game.channelId, {
          content: `Game ended — join post-game discussion in <#${thread.id}> (ask a storyteller to add you if needed).`,
        });
      }
      await interaction.reply({
        content: `Game ended. ${winner} wins: ${reason}${cleanupHint}.${threadHint}`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }
}

import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { getActiveGameForGuild, prisma } from "@grimkeeper/database";
import { GameCommandKind, GameEngine } from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import { type StandardEditionChoice } from "../edition-choices.js";
import { castVoteFromSlash } from "../interactions/day-vote.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  applyGameChannelPermissions,
  createKibThread,
  deferInteractionReply,
  ensureGameRoles,
  getGameRoles,
  loadEngine,
  loadScriptForCreate,
  persistEvents,
  postNominationEverywhere,
  refreshNominationEverywhere,
  removeRoleFromUser,
  replyEngineError,
  replyOrEditInteraction,
  requireActivePlayerGame,
  requireCommandAccess,
  requireTownVotingChannel,
  syncGameProjection,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameCommandsMinimal {
  @Slash({ name: "create", description: "Create a new game in this channel" })
  async create(
    @SlashChoice({ name: "Trouble Brewing", value: "tb" })
    @SlashChoice({ name: "Bad Moon Rising", value: "bmr" })
    @SlashChoice({ name: "Sects & Violets", value: "snv" })
    @SlashOption({
      name: "edition",
      description: "Script edition",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    edition: StandardEditionChoice | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "This command must be used in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getActiveGameForGuild(interaction.guildId);
    if (existing) {
      await interaction.reply({
        content: "An active game already exists in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let script;
    try {
      script = await loadScriptForCreate(edition, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load script.";
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      return;
    }

    await deferInteractionReply(interaction);

    const gameId = randomUUID();
    let roleHint = "";
    let gameRoles = null;
    if (GAME_DISCORD_ROLES_ENABLED) {
      gameRoles = await ensureGameRoles(interaction.guild, interaction.channelId);
      if (!gameRoles) {
        await replyOrEditInteraction(interaction, {
          content: "I couldn't create game roles. Check bot permissions (`Manage Roles`).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await addRoleToUser(interaction.guild, interaction.user.id, gameRoles.stRole.id);
      await applyGameChannelPermissions(
        interaction.guild!,
        interaction.channelId,
        gameRoles.stRole.id,
        gameRoles.playersRole.id,
      );
      roleHint = ` Roles created: <@&${gameRoles.stRole.id}>, <@&${gameRoles.playersRole.id}>, and spectator <@&${gameRoles.spectatorRole.id}>.`;
    }

    const engine = new GameEngine(gameId);
    const events = engine.handle({
      kind: GameCommandKind.CreateGame,
      gameId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      storytellerId: interaction.user.id,
      script,
    });

    await prisma.game.create({
      data: {
        id: gameId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        phase: "lobby",
      },
    });

    await persistEvents(engine, events);

    const kibThread = await createKibThread(interaction, gameId, gameRoles ?? undefined);
    const devHint = isDevMode() ? " Dev mode: use `/dev fill` to add fake players." : "";
    const threadHint = kibThread
      ? ` Kib thread created: ${kibThread}.`
      : " I could not create a kib thread (missing permissions or unsupported channel type).";

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription(
            `Script: **${script.name}** (${script.roles.length} characters).\nStoryteller: run \`/st setup-town\` with ordered @mentions to set up players and open voting.${roleHint}${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "join", description: "Join the active game lobby" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({
        content: "No active game found. Create one with `/game create`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const playerId = randomUUID();
    const events = engine.handle({
      kind: GameCommandKind.AddPlayer,
      gameId: game.id,
      playerId,
      discordUserId: interaction.user.id,
      displayName: interaction.user.displayName ?? interaction.user.username,
    });

    await persistEvents(engine, events);
    await prisma.player.create({
      data: {
        id: playerId,
        gameId: game.id,
        discordUserId: interaction.user.id,
        displayName: interaction.user.displayName ?? interaction.user.username,
        seat: engine.getState().players.find((p) => p.id === playerId)?.seat ?? null,
      },
    });
    if (GAME_DISCORD_ROLES_ENABLED) {
      const roles = await getGameRoles(interaction.guild, game.channelId);
      if (roles) {
        await addRoleToUser(interaction.guild, interaction.user.id, roles.playersRole.id);
      }
    }
    await interaction.reply({
      content: `Joined the game. ${engine.getState().players.length} player(s) in lobby.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "leave", description: "Leave the active game lobby" })
  async leave(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
      return;
    }

    const engine = await loadEngine(game.id);
    const player = engine
      .getState()
      .players.find((candidate) => candidate.discordUserId === interaction.user.id);
    if (!player) {
      await interaction.reply({
        content: "You are not currently in this game's lobby.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const events = engine.handle({
        kind: GameCommandKind.RemovePlayer,
        gameId: game.id,
        playerId: player.id,
      });
      await persistEvents(engine, events);
      await prisma.player.deleteMany({
        where: { id: player.id, gameId: game.id },
      });
      if (GAME_DISCORD_ROLES_ENABLED) {
        const roles = await getGameRoles(interaction.guild, game.channelId);
        if (roles) {
          await removeRoleFromUser(interaction.guild, interaction.user.id, roles.playersRole.id);
        }
      }
      await interaction.reply({
        content: `You left the lobby. ${engine.getState().players.length} player(s) remain.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "list", description: "List active games in this server" })
  async list(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const games = await prisma.game.findMany({
      where: {
        guildId: interaction.guildId,
        phase: { not: "ended" },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    if (games.length === 0) {
      await interaction.reply({
        content: "No active games found in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = games.map(
      (game) => `- \`${game.id}\` in <#${game.channelId}> — phase: **${game.phase}**`,
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Active Grimkeeper games")
          .setDescription(lines.join("\n")),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "nominate", description: "Nominate another player for execution (town or voting thread)" })
  async nominate(
    @SlashOption({
      name: "player",
      description: "Player to nominate",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    @SlashOption({
      name: "accusation",
      description: "Your accusation against this player",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    accusation: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player: nominator } = context;
    if (!(await requireTownVotingChannel(interaction, game, engine))) return;

    const target = engine.getPlayerByDiscordId(nominee.id);
    if (!target) {
      await replyOrEditInteraction(interaction, {
        content: "That user is not in this game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const events = engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId: game.id,
        nominatorId: nominator.id,
        nomineeId: target.id,
        accusation,
      });
      await persistEvents(engine, events);

      const nominationEvent = events.find((event) => event.type === "NominationMade");
      const nominationId =
        nominationEvent && "nominationId" in nominationEvent
          ? nominationEvent.nominationId
          : engine.getState().day?.nominations.at(-1)?.id;

      if (interaction.guild && nominationId) {
        const posted = await postNominationEverywhere(
          interaction.guild,
          game,
          engine,
          nominationId,
        );
        const voteThreadId = engine.getState().day?.discordThreadId;
        await replyOrEditInteraction(interaction, {
          content: [
            `<@${nominator.discordUserId}> nominates <@${target.discordUserId}>.`,
            voteThreadId ? `Posted in <#${voteThreadId}>` : "",
            posted.privateBallots > 0
              ? `and ${posted.privateBallots} private ST ballots.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await replyOrEditInteraction(interaction, {
          content: `<@${nominator.discordUserId}> nominates <@${target.discordUserId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "defend", description: "Add your defense to a nomination against you" })
  async defend(
    @SlashOption({
      name: "text",
      description: "Your defense",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    defenseText: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player } = context;
    if (!(await requireTownVotingChannel(interaction, game, engine))) return;

    const nomination = engine
      .getState()
      .day?.nominations.find(
        (candidate) => candidate.nomineeId === player.id && candidate.status === "open",
      );
    if (!nomination) {
      await replyOrEditInteraction(interaction, {
        content: "You do not have an open nomination to defend.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const events = engine.handle({
        kind: GameCommandKind.AddDefense,
        gameId: game.id,
        playerId: player.id,
        nominationId: nomination.id,
        defense: defenseText,
      });
      await persistEvents(engine, events);

      if (interaction.guild) {
        await refreshNominationEverywhere(interaction.guild, game, engine, nomination.id);
      }

      await replyOrEditInteraction(interaction, {
        content: "Defense recorded.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "vote", description: "Vote on an open nomination (voting thread or private ST thread)" })
  async vote(
    @SlashOption({
      name: "nominee",
      description: "The nominated player you are voting on",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    @SlashOption({
      name: "choice",
      description: "Your vote",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    choice: "yes" | "no" | "conditional",
    @SlashOption({
      name: "reason",
      description: "Required for conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player: voter } = context;
    if (!(await requireTownVotingChannel(interaction, game, engine))) return;

    const target = engine.getPlayerByDiscordId(nominee.id);
    if (!target) {
      await replyOrEditInteraction(interaction, {
        content: "That user is not in this game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nomination = engine
      .getState()
      .day?.nominations.find(
        (candidate) => candidate.nomineeId === target.id && candidate.status === "open",
      );
    if (!nomination) {
      await replyOrEditInteraction(interaction, {
        content: "That player does not have an open nomination.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const { engine: updatedEngine, events } = await castVoteFromSlash(
        game.id,
        voter.id,
        nomination.id,
        choice,
        reason?.trim() ?? null,
      );
      await persistEvents(updatedEngine, events);
      await syncGameProjection(game.id, updatedEngine);

      const day = updatedEngine.getState().day;
      const isSecret = day?.voteVisibility === "secret";
      const isSt = updatedEngine.isStoryteller(interaction.user.id);

      if (interaction.guild) {
        await refreshNominationEverywhere(
          interaction.guild,
          game,
          updatedEngine,
          nomination.id,
          { revealSecret: false },
        );
      }

      if (isSecret && !isSt) {
        await replyOrEditInteraction(interaction, {
          content: "Vote recorded privately.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const tally = updatedEngine.formatNominationTally(nomination.id, { revealSecret: true });
      await replyOrEditInteraction(interaction, {
        content: `Vote recorded (${choice}). ${tally}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "roster", description: "Show seat order and alive/dead status" })
  async roster(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await replyOrEditInteraction(interaction, {
        content: "No active game found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    if (!state.townMode || state.phase !== "day") {
      await replyOrEditInteraction(interaction, {
        content: "Town is not set up yet. Storyteller must run `/st setup-town`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Town roster")
          .setDescription(engine.getSeatingChart().join("\n")),
      ],
    });
  }
}
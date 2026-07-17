import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getActiveGameForChannel, listActiveGamesForGuild, prisma } from "@grimkeeper/database";
import {
  GameCommandKind,
  GameEngine,
  GameEventType,
  troubleBrewingRoles,
  type GameScript,
} from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import { buildRoleEmbed } from "../role-embed.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  createPersonalPlayerThread,
  createStorytellerThread,
  ensureGameRoles,
  getGameRoles,
  loadEngine,
  loadScriptForCreate,
  minPlayers,
  multipleActiveGamesHint,
  persistEvents,
  removeRoleFromUser,
  replyEngineError,
  requireActivePlayerGame,
  requireCommandAccess,
  requireDayThread,
  resolveActiveGameForInteraction,
  syncGameProjection,
} from "./command-context.js";
import { upsertPinnedSeatingChart } from "../seating-chart.js";
import {
  postNominationToDayThread,
  updateNominationMessage,
  type DayDiscussionChannel,
} from "../day-thread.js";
import { castVoteFromSlash } from "../interactions/day-vote.js";

function resolveRoleQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return troubleBrewingRoles.find(
    (role) =>
      role.id === normalized ||
      role.name.toLowerCase() === normalized ||
      role.name.toLowerCase().replace(/ /g, "_") === normalized,
  );
}

function resolveDayDiscussionChannel(
  interaction: CommandInteraction,
): DayDiscussionChannel | null {
  const channel = interaction.channel;
  if (!channel?.isTextBased() || channel.isDMBased()) return null;
  return channel as DayDiscussionChannel;
}

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameCommands {
  @Slash({ name: "create", description: "Create a new game in this channel" })
  async create(
    @SlashOption({
      name: "edition",
      description: "Standard edition: TB, BMR, or SNV (default TB)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    edition: string | undefined,
    @SlashOption({
      name: "script",
      description: "URL to a script JSON file (overrides edition)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    scriptUrl: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({ content: "This command must be used in a server channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    const existing = await getActiveGameForChannel(interaction.guildId, interaction.channelId);
    if (existing) {
      await interaction.reply({ content: "An active game already exists in this channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    let script: GameScript;
    try {
      script = await loadScriptForCreate(edition, scriptUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load script.";
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      return;
    }

    const gameId = randomUUID();
    let roleHint = "";
    if (GAME_DISCORD_ROLES_ENABLED) {
      const gameRoles = await ensureGameRoles(interaction.guild, interaction.channelId);
      if (!gameRoles) {
        await interaction.reply({
          content: "I couldn't create game roles. Check bot permissions (`Manage Roles`).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await addRoleToUser(interaction.guild, interaction.user.id, gameRoles.stRole.id);
      roleHint = ` Roles created: <@&${gameRoles.stRole.id}> and <@&${gameRoles.playersRole.id}>.`;
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

    const storytellerThread = await createStorytellerThread(interaction, gameId);
    const devHint = isDevMode()
      ? " Dev mode: use `/dev fill` to add fake players."
      : "";
    const threadHint = storytellerThread
      ? ` Storyteller thread created: ${storytellerThread}.`
      : " I could not create a storyteller thread (missing permissions or unsupported channel type).";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription(
            `Script: **${script.name}** (${script.roles.length} characters).\nPlayers can join with \`/game join\`. Storyteller can start once there are at least ${minPlayers()} players with \`/st start\`, then set up the grimoire.${roleHint}${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "join", description: "Join the active game lobby" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
      await interaction.reply({
        content:
          activeCount > 1
            ? multipleActiveGamesHint()
            : "No active game found. Create one with `/game create`.",
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
      const gameRoles = await getGameRoles(interaction.guild, game.channelId);
      if (gameRoles) {
        await addRoleToUser(interaction.guild, interaction.user.id, gameRoles.playersRole.id);
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
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
      await interaction.reply({
        content: activeCount > 1 ? multipleActiveGamesHint() : "No active game found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const player = engine
      .getState()
      .players.find((candidate) => candidate.discordUserId === interaction.user.id);
    if (!player) {
      await interaction.reply({ content: "You are not currently in this game's lobby.", flags: MessageFlags.Ephemeral });
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
        const gameRoles = await getGameRoles(interaction.guild, game.channelId);
        if (gameRoles) {
          await removeRoleFromUser(interaction.guild, interaction.user.id, gameRoles.playersRole.id);
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
  @Slash({ name: "role", description: "Show a Trouble Brewing role with official art" })
  async role(
    @SlashOption({
      name: "name",
      description: "Role name (e.g. Washerwoman, Fortune Teller, Imp)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    roleQuery: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const role = resolveRoleQuery(roleQuery);
    if (!role) {
      await interaction.reply({
        content: `Unknown role "${roleQuery}". Try names like Washerwoman, Fortune Teller, or Imp.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildRoleEmbed(role.id);
    if (!embed) {
      await interaction.reply({ content: "Unknown role.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  @Slash({ name: "roles", description: "List Trouble Brewing roles on the script" })
  async roles(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const byType = ["townsfolk", "outsider", "minion", "demon"] as const;
    const fields = byType.map((type) => ({
      name: type.charAt(0).toUpperCase() + type.slice(1),
      value: troubleBrewingRoles
        .filter((role) => role.type === type)
        .map((role) => `**${role.name}** — ${role.ability}`)
        .join("\n"),
    }));

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Trouble Brewing")
          .setDescription("Official script roles in Grimkeeper. Use `/game role` to view character art.")
          .addFields(fields),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "list", description: "List active games in this server" })
  async list(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ content: "No active games found in this server.", flags: MessageFlags.Ephemeral });
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
  @Slash({ name: "seat", description: "Pick your seat during setup" })
  async seat(
    @SlashOption({
      name: "number",
      description: "Seat number to take",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    seatNumber: number,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player } = context;

    try {
      const events = engine.handle({
        kind: GameCommandKind.PickSeat,
        gameId: game.id,
        playerId: player.id,
        seat: seatNumber,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      if (interaction.guild) {
        await upsertPinnedSeatingChart(interaction.guild, game.channelId, engine);
      }

      await interaction.reply({
        content: `You are seated at **seat ${seatNumber}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "seats", description: "Show the current seating chart" })
  async seats(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
      await interaction.reply({
        content: activeCount > 1 ? multipleActiveGamesHint() : "No active game found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    if (state.phase === "lobby") {
      await interaction.reply({
        content: "Seating opens after `/st start`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const status = state.seatsOpen ? "Seat selection is **open**." : "Seat selection is **closed**.";
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Seating")
          .setDescription(`${status}\n\n${engine.getSeatingChart().join("\n")}`),
      ],
    });
  }

  @Slash({ name: "nominate", description: "Nominate another player for execution (day thread only)" })
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
    if (!(await requireDayThread(interaction, game, engine))) return;

    const target = engine.getPlayerByDiscordId(nominee.id);
    if (!target) {
      await interaction.reply({
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

      const nominationEvent = events.find((event) => event.type === GameEventType.NominationMade);
      const nominationId =
        nominationEvent && "nominationId" in nominationEvent
          ? nominationEvent.nominationId
          : engine.getState().day?.nominations.at(-1)?.id;

      const dayChannel = resolveDayDiscussionChannel(interaction);
      if (dayChannel && nominationId) {
        await postNominationToDayThread(engine, game.id, dayChannel, nominationId);
      }

      await interaction.reply({
        content: `<@${nominator.discordUserId}> nominates <@${target.discordUserId}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "defend", description: "Add your defense to a nomination against you (day thread only)" })
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
    if (!(await requireDayThread(interaction, game, engine))) return;

    const nomination = engine
      .getState()
      .day?.nominations.find(
        (candidate) => candidate.nomineeId === player.id && candidate.status === "open",
      );
    if (!nomination) {
      await interaction.reply({
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

      const dayChannel = resolveDayDiscussionChannel(interaction);
      if (dayChannel) {
        await updateNominationMessage(engine, game.id, dayChannel, nomination.id);
      }

      await interaction.reply({
        content: "Defense recorded.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "vote", description: "Vote on a nomination (day thread only)" })
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
    if (!(await requireDayThread(interaction, game, engine))) return;

    const target = engine.getPlayerByDiscordId(nominee.id);
    if (!target) {
      await interaction.reply({
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
      await interaction.reply({
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

      const dayChannel = resolveDayDiscussionChannel(interaction);
      if (dayChannel) {
        await updateNominationMessage(updatedEngine, game.id, dayChannel, nomination.id, {
          revealSecret: isSt,
        });
      }

      if (isSecret && !isSt) {
        await interaction.reply({ content: "Vote recorded.", flags: MessageFlags.Ephemeral });
        return;
      }

      const tally = updatedEngine.formatNominationTally(nomination.id, { revealSecret: true });
      await interaction.reply({
        content: `Vote recorded (${choice}). ${tally}`,
        flags: isSecret ? MessageFlags.Ephemeral : undefined,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "nominations", description: "List nominations for the current day" })
  async nominations(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
      await interaction.reply({
        content: activeCount > 1 ? multipleActiveGamesHint() : "No active game found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    const day = state.day;
    if (state.phase !== "day" || !day) {
      await interaction.reply({
        content: "There is no open nomination phase right now.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (day.nominations.length === 0) {
      await interaction.reply({
        content: `Day ${state.dayNumber}: no nominations yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isSt = engine.isStoryteller(interaction.user.id);
    const lines = day.nominations
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((nomination) => {
        const nominator = engine.getPlayerById(nomination.nominatorId);
        const nominee = engine.getPlayerById(nomination.nomineeId);
        const tally = engine.formatNominationTally(nomination.id, {
          revealSecret: isSt || day.voteVisibility === "public",
        });
        return `#${nomination.order} <@${nominator?.discordUserId ?? "unknown"}> → <@${nominee?.discordUserId ?? "unknown"}> (${nomination.status}) — ${tally}`;
      });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Day ${state.dayNumber} nominations`)
          .setDescription(lines.join("\n")),
      ],
    });
  }
}
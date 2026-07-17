import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  createReminder,
  getActiveGameForGuild,
  cancelGameReminders,
} from "@grimkeeper/database";
import {
  GameCommandKind,
  dealRolesFromScript,
  findScriptRole,
  getScriptCompositionText,
} from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import {
  buildDayIntroEmbed,
  formatVoteVisibility,
  parsePauseDurationMinutes,
  updateNominationMessage,
  type DayDiscussionChannel,
} from "../day-thread.js";
import { upsertPinnedSeatingChart } from "../seating-chart.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  buildPlayerPingMention,
  cleanupGameRoles,
  createDayThread,
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
import { runDevKill, runSetPlayerVote } from "../set-vote.js";

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

    const thread = await getStorytellerThread(guild, game.channelId, {
      kibThreadId: game.kibThreadId,
      gameId: game.id,
    });
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

      if (GAME_DISCORD_ROLES_ENABLED) {
        const gameRoles = await getGameRoles(guild, game.channelId);
        if (gameRoles) {
          await addRoleToUser(guild, user.id, gameRoles.stRole.id);
        }
      }

      await interaction.reply({
        content: `Promoted <@${user.id}> to storyteller. Use \`/st add-spectator\` to add them to the ST thread.`,
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
    if (!interaction.guildId) return;

    const mention = await buildPlayerPingMention(game.id, interaction.guildId);
    await interaction.reply({ content: mention || "No players to ping." });
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
      const thread = await getStorytellerThread(guild, game.channelId, {
        kibThreadId: game.kibThreadId,
        gameId: game.id,
      });
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

      await postToStorytellerThread(guild, game.channelId, { embeds: [stEmbed] }, game.id);
      await upsertPinnedSeatingChart(guild, game.channelId, engine);

      await interaction.reply({
        content: "Seat selection is open. A pinned seating chart was posted in town.",
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

      await postToStorytellerThread(guild, game.channelId, { embeds: [townEmbed] }, game.id);
      await upsertPinnedSeatingChart(guild, game.channelId, engine);

      await interaction.reply({
        content: allSeated
          ? "Seat selection closed. Pinned seating chart updated."
          : "Seat selection closed, but some players are still unseated. Pinned chart updated.",
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

  @Slash({ name: "day", description: "Advance to the next day and open the day thread" })
  async day(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: GameCommandKind.AdvancePhase, gameId: game.id, targetPhase: "day" });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const dayNumber = engine.getState().dayNumber;
      const dayThread = await createDayThread(guild, game.channelId, game.id, dayNumber, engine);
      if (!dayThread) {
        await interaction.reply({
          content: `Day ${dayNumber} started, but I could not create the day thread (check permissions).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const openEvents = engine.handle({
        kind: GameCommandKind.OpenDay,
        gameId: game.id,
        discordThreadId: dayThread.id,
      });
      await persistEvents(engine, openEvents);

      const introEmbed = buildDayIntroEmbed(engine);
      await dayThread.send({ embeds: [introEmbed] }).catch(() => undefined);
      await upsertPinnedGameStatus(guild, dayThread.id, engine);
      await postToTownChannel(guild, game.channelId, {
        content: `Day ${dayNumber} has begun — discuss and vote in <#${dayThread.id}>.`,
      });

      await interaction.reply({
        content: `Day ${dayNumber} started. Town square: <#${dayThread.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "pause-nominations", description: "Pause new nominations for a duration" })
  async pauseNominations(
    @SlashOption({
      name: "duration",
      description: "How long to pause (e.g. 5m, 10, 15m)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    duration: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const minutes = parsePauseDurationMinutes(duration);
    if (!minutes) {
      await interaction.reply({
        content: "Duration must be a number of minutes between 1 and 120 (e.g. `5m` or `10`).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      const pausedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
      const events = engine.handle({
        kind: GameCommandKind.PauseNominations,
        gameId: game.id,
        pausedUntil,
      });
      await persistEvents(engine, events);

      const dayThreadId = engine.getState().day?.discordThreadId ?? game.channelId;
      if (interaction.guildId) {
        await createReminder({
          gameId: game.id,
          guildId: interaction.guildId,
          channelId: dayThreadId,
          message: "Nominations pause ended — players may nominate again.",
          fireAt: new Date(pausedUntil),
          createdBy: interaction.user.id,
        });
      }

      if (dayThreadId && interaction.guild) {
        const thread = await interaction.guild.channels.fetch(dayThreadId).catch(() => null);
        if (thread?.isTextBased()) {
          await thread.send(`Nominations paused for **${minutes}** minute(s).`).catch(() => undefined);
        }
      }

      await interaction.reply({
        content: `Nominations paused for ${minutes} minute(s).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "vote-visibility", description: "Set public or secret vote visibility (Organ Grinder mode)" })
  async voteVisibility(
    @SlashOption({
      name: "mode",
      description: "public shows tallies; secret hides them from players",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    mode: "public" | "secret",
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.SetVoteVisibility,
        gameId: game.id,
        visibility: mode,
      });
      await persistEvents(engine, events);

      const dayThreadId = engine.getState().day?.discordThreadId;
      if (dayThreadId && interaction.guild) {
        const thread = await interaction.guild.channels.fetch(dayThreadId).catch(() => null);
        if (thread?.isTextBased()) {
          await thread
            .send(`Vote visibility is now **${formatVoteVisibility(mode)}**.`)
            .catch(() => undefined);
        }
      }

      await interaction.reply({
        content: `Vote visibility set to **${formatVoteVisibility(mode)}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "close-nominations", description: "Stop new nominations and votes for the day" })
  async closeNominations(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.CloseNominations,
        gameId: game.id,
      });
      await persistEvents(engine, events);

      const dayThreadId = engine.getState().day?.discordThreadId;
      if (dayThreadId && interaction.guild) {
        const thread = await interaction.guild.channels.fetch(dayThreadId).catch(() => null);
        if (thread?.isTextBased()) {
          await thread.send("Nominations and voting are now **closed**.").catch(() => undefined);
        }
      }

      await interaction.reply({
        content: "Nominations and voting closed.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "resolve-next", description: "Resolve the next nomination in queue order" })
  async resolveNext(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const next = engine.getNextOpenNomination();
      if (!next) {
        await interaction.reply({
          content: "No open nominations remain to resolve.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.ResolveNomination,
        gameId: game.id,
      });
      await persistEvents(engine, events);

      const resolved = engine.getNominationById(next.id);
      const yesVotes = engine.getEffectiveYesVotes(next.id);
      const livingCount = engine.countLivingPlayers();
      const nominee = engine.getPlayerById(next.nomineeId);
      const passed = resolved?.status === "resolved_pass";
      const tally = engine.formatNominationTally(next.id, { revealSecret: true });

      const dayThreadId = engine.getState().day?.discordThreadId;
      if (dayThreadId && interaction.guild) {
        const thread = await interaction.guild.channels.fetch(dayThreadId).catch(() => null);
        if (thread?.isThread()) {
          await updateNominationMessage(
            engine,
            game.id,
            thread as DayDiscussionChannel,
            next.id,
            { revealSecret: true },
          );
          await thread
            .send(
              `Nomination #${next.order} for **${nominee?.displayName ?? "Unknown"}** ${passed ? "**passed**" : "**failed**"} (${yesVotes}/${livingCount} living, ${tally}).` +
                (passed ? " ST may run `/st execute`." : ""),
            )
            .catch(() => undefined);
        }
      }

      await interaction.reply({
        content: `Nomination #${next.order} ${passed ? "passed" : "failed"}. ${tally}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "execute", description: "Execute a player after a nomination passes" })
  async execute(
    @SlashOption({
      name: "player",
      description: "Player to execute",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const target = engine.getPlayerByDiscordId(player.id);
      if (!target) {
        await interaction.reply({ content: "That user is not in this game.", flags: MessageFlags.Ephemeral });
        return;
      }

      const nomination = engine
        .getState()
        .day?.nominations.find(
          (candidate) =>
            candidate.nomineeId === target.id && candidate.status === "resolved_pass",
        );
      if (!nomination) {
        await interaction.reply({
          content: "That player does not have a passed nomination to execute.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.ExecutePlayer,
        gameId: game.id,
        playerId: target.id,
        nominationId: nomination.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const dayThreadId = engine.getState().day?.discordThreadId;
      if (dayThreadId && interaction.guild) {
        const thread = await interaction.guild.channels.fetch(dayThreadId).catch(() => null);
        if (thread?.isThread()) {
          await updateNominationMessage(
            engine,
            game.id,
            thread as DayDiscussionChannel,
            nomination.id,
            { revealSecret: true },
          );
          await thread
            .send(`<@${target.discordUserId}> has been **executed**.`)
            .catch(() => undefined);
        }
      }

      await postToTownChannel(interaction.guild!, game.channelId, {
        content: `<@${target.discordUserId}> was executed on day ${engine.getState().dayNumber}.`,
      });

      await interaction.reply({
        content: `Executed **${target.displayName}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "kill", description: "Mark a player dead (night kill or other cause)" })
  async kill(
    @SlashOption({
      name: "player",
      description: "Player to kill",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    player: User | undefined,
    @SlashOption({
      name: "seat",
      description: "Seat for fake/dev players",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 15,
    })
    seat: number | undefined,
    @SlashOption({
      name: "cause",
      description: "Cause of death (default: night)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    cause: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    if (!player && seat == null) {
      await interaction.reply({
        content: "Provide a `player` or `seat`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await runDevKill({
      interaction,
      gameId: game.id,
      userId: player?.id,
      seat: seat ?? null,
      cause: cause?.trim() || "night",
    });
  }

  @Slash({ name: "set-vote", description: "Manually set a player's vote on a nomination" })
  async setVote(
    @SlashOption({
      name: "choice",
      description: "Vote to record",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    choice: "yes" | "no" | "conditional",
    @SlashOption({
      name: "voter",
      description: "Living player casting the vote",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    voter: User | undefined,
    @SlashOption({
      name: "voter_seat",
      description: "Seat number for fake/dev players",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 15,
    })
    voterSeat: number | undefined,
    @SlashOption({
      name: "nominee",
      description: "Nominated player",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominee: User | undefined,
    @SlashOption({
      name: "nominee_seat",
      description: "Nominee seat for fake/dev players",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 15,
    })
    nomineeSeat: number | undefined,
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
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    await runSetPlayerVote({
      interaction,
      gameId: game.id,
      guild: interaction.guild,
      voterUserId: voter?.id,
      voterSeat: voterSeat ?? null,
      nomineeUserId: nominee?.id,
      nomineeSeat: nomineeSeat ?? null,
      choice,
      reason: reason ?? null,
    });
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
      await cancelGameReminders(game.id);
      if (GAME_DISCORD_ROLES_ENABLED) {
        await cleanupGameRoles(guild, game.channelId);
      }
      const thread = await openStorytellerThread(guild, game.channelId);
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

import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  Role,
  type GuildBasedChannel,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getActiveGameForChannel, listActiveGamesForGuild, prisma } from "@grimkeeper/database";
import { GameCommandKind, GameEngine } from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import { ensureLogThread, postGameLog, postGameLogRoleChange } from "../game-log-thread.js";
import {
  addRoleToUser,
  applyGameChannelPermissions,
  createKibThread,
  deferInteractionReply,
  isGameTextChannel,
  isKibChannelVenue,
  loadEngine,
  multipleActiveGamesHint,
  persistEvents,
  removeRoleFromUser,
  replyEngineError,
  replyOrEditInteraction,
  requireCommandAccess,
  resolveActiveGameForInteraction,
  resolveGameRoles,
  setInteractionProgress,
} from "./command-context.js";

function isAttachableKibVenue(channel: GuildBasedChannel | null | undefined): boolean {
  if (!channel) return false;
  if (channel.isThread()) {
    return (
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.AnnouncementThread
    );
  }
  return isGameTextChannel(channel);
}

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameCommandsMinimal {
  @Slash({ name: "setup", description: "Create a game with existing ST/player/kib roles" })
  async setup(
    @SlashOption({
      name: "st",
      description: "Existing storyteller role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    stRole: Role,
    @SlashOption({
      name: "player_role",
      description: "Existing player role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    playerRole: Role,
    @SlashOption({
      name: "kib",
      description: "Existing kib/spectator role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    kibRole: Role,
    @SlashOption({
      name: "kib_thread",
      description: "Existing kib channel or thread (optional; auto-creates a kib thread if omitted)",
      type: ApplicationCommandOptionType.Channel,
      required: false,
      channelTypes: [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PrivateThread,
        ChannelType.PublicThread,
        ChannelType.AnnouncementThread,
      ],
    })
    kibVenue: GuildBasedChannel | undefined,
    @SlashOption({
      name: "log_thread",
      description:
        "Existing ST log thread (optional; auto-created under kib channel or town)",
      type: ApplicationCommandOptionType.Channel,
      required: false,
      channelTypes: [ChannelType.PrivateThread, ChannelType.PublicThread],
    })
    logThread: GuildBasedChannel | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    if (!interaction.guildId || !interaction.channelId || !interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (kibVenue && !isAttachableKibVenue(kibVenue)) {
      await replyOrEditInteraction(interaction, {
        content: "`kib_thread` must be a text/announcement channel or a thread.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (kibVenue?.isThread() && kibVenue.parentId !== interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "A kib **thread** must be under this town channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (kibVenue && isKibChannelVenue(kibVenue) && kibVenue.id === interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "Kib channel must be different from the town channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const expectedLogParentId =
      kibVenue && isKibChannelVenue(kibVenue) ? kibVenue.id : interaction.channelId;

    if (logThread) {
      if (!logThread.isThread()) {
        await replyOrEditInteraction(interaction, {
          content: "`log_thread` must be a thread.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (logThread.parentId !== expectedLogParentId) {
        await replyOrEditInteraction(interaction, {
          content:
            kibVenue && isKibChannelVenue(kibVenue)
              ? "`log_thread` must be a thread under the kib channel."
              : "`log_thread` must be a thread under this town channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const existing = await getActiveGameForChannel(interaction.guildId, interaction.channelId);
    if (existing) {
      await replyOrEditInteraction(interaction, {
        content: "An active game already exists in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deferInteractionReply(interaction);

    const gameId = randomUUID();
    const gameRoles = { stRole, playersRole: playerRole, spectatorRole: kibRole };
    const kibIsChannel = Boolean(kibVenue && isKibChannelVenue(kibVenue));

    await setInteractionProgress(interaction, "Assigning roles…");
    await addRoleToUser(interaction.guild, interaction.user.id, stRole.id);
    await applyGameChannelPermissions(
      interaction.guild!,
      interaction.channelId,
      stRole.id,
      playerRole.id,
    );

    await setInteractionProgress(interaction, "Creating game…");
    const engine = new GameEngine(gameId);
    const events = engine.handle({
      kind: GameCommandKind.CreateGame,
      gameId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      storytellerId: interaction.user.id,
    });

    await prisma.game.create({
      data: {
        id: gameId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        phase: "lobby",
        stRoleId: stRole.id,
        playerRoleId: playerRole.id,
        kibRoleId: kibRole.id,
      },
    });

    await persistEvents(engine, events);

    await setInteractionProgress(
      interaction,
      kibVenue
        ? kibIsChannel
          ? "Attaching kib channel…"
          : "Attaching kib thread…"
        : "Creating kib thread…",
    );
    const kibResult = await createKibThread(interaction, gameId, gameRoles, {
      kibRoleId: kibRole.id,
      existingThreadId: kibVenue?.id,
    });

    // Persist kib before creating the log so the log always nests under a kib *channel* when used.
    if (kibResult.threadId) {
      await prisma.game.update({
        where: { id: gameId },
        data: { kibThreadId: kibResult.threadId },
      });
    }

    await setInteractionProgress(interaction, logThread ? "Attaching log thread…" : "Creating log thread…");
    const logResult = await ensureLogThread(interaction.guild, {
      id: gameId,
      channelId: interaction.channelId,
      stRoleId: stRole.id,
      playerRoleId: playerRole.id,
      kibRoleId: kibRole.id,
      kibThreadId: kibResult.threadId,
      logThreadId: logThread?.id ?? null,
    }, engine, {
      existingThreadId: logThread?.id,
      invokerId: interaction.user.id,
    });

    if (logResult.threadId) {
      await prisma.game.update({
        where: { id: gameId },
        data: { logThreadId: logResult.threadId },
      });
    }

    const gameRecord = {
      id: gameId,
      channelId: interaction.channelId,
      stRoleId: stRole.id,
      playerRoleId: playerRole.id,
      kibRoleId: kibRole.id,
      kibThreadId: kibResult.threadId,
      logThreadId: logResult.threadId,
    };

    await setInteractionProgress(interaction, "Writing audit log…");
    await postGameLogRoleChange(
      interaction.guild,
      gameRecord,
      "added",
      interaction.user.id,
      `<@&${stRole.id}> (ST)`,
      interaction.user.id,
    );
    await postGameLog(
      interaction.guild,
      gameRecord,
      `<@${interaction.user.id}> set up game — ST <@&${stRole.id}>, players <@&${playerRole.id}>, kib <@&${kibRole.id}>.` +
        (kibResult.mention ? ` Kib: ${kibResult.mention}.` : "") +
        (logResult.thread ? ` Log: <#${logResult.thread.id}>.` : ""),
    );

    const kibLabel = kibIsChannel ? "kib channel" : "kib thread";
    const devHint = isDevMode() ? " Dev mode: use `/dev fill` to add fake players." : "";
    const threadHint = kibResult.mention
      ? ` ${kibLabel.charAt(0).toUpperCase()}${kibLabel.slice(1)}: ${kibResult.mention}.`
      : kibVenue
        ? ` Could not attach the chosen ${kibLabel}.`
        : " I could not create a kib thread (missing permissions or unsupported channel type).";
    const logHint = logResult.thread
      ? ` ST log thread: <#${logResult.thread.id}>.`
      : logThread
        ? " Could not attach the chosen log thread."
        : "";
    const roleHint = ` Roles: <@&${stRole.id}>, <@&${playerRole.id}>, kib <@&${kibRole.id}>.`;

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game set up")
          .setDescription(
            `Game ready in this channel.\nStoryteller: run \`/st do setup-town\` with ordered @mentions to set up players and open voting.${roleHint}${threadHint}${logHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "create", description: "Create a game lobby (legacy — prefer /game setup)" })
  async create(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    if (!interaction.guildId || !interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getActiveGameForChannel(interaction.guildId, interaction.channelId);
    if (existing) {
      await replyOrEditInteraction(interaction, {
        content: "An active game already exists in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deferInteractionReply(interaction);

    const gameId = randomUUID();

    const engine = new GameEngine(gameId);
    const events = engine.handle({
      kind: GameCommandKind.CreateGame,
      gameId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      storytellerId: interaction.user.id,
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

    const devHint = isDevMode() ? " Dev mode: use `/dev fill` to add fake players." : "";
    const threadHint = " Prefer `/game setup` with your existing ST, player, and kib roles.";

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription(
            `Game lobby created.\nStoryteller: run \`/st do setup-town\` with ordered @mentions to set up players and open voting.${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "join", description: "Join the lobby" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = interaction.guildId
        ? (await listActiveGamesForGuild(interaction.guildId)).length
        : 0;
      await replyOrEditInteraction(interaction, {
        content:
          activeCount > 1
            ? multipleActiveGamesHint()
            : "No active game found. Create one with `/game setup`.",
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
    const roles = await resolveGameRoles(interaction.guild, game);
    if (roles) {
      await addRoleToUser(interaction.guild, interaction.user.id, roles.playersRole.id);
      if (interaction.guild) {
        await postGameLogRoleChange(
          interaction.guild,
          game,
          "added",
          interaction.user.id,
          `<@&${roles.playersRole.id}> (player)`,
          interaction.user.id,
        );
      }
    }
    await replyOrEditInteraction(interaction, {
      content: `Joined the game. ${engine.getState().players.length} player(s) in lobby.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "leave", description: "Leave the lobby" })
  async leave(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      const activeCount = interaction.guildId
        ? (await listActiveGamesForGuild(interaction.guildId)).length
        : 0;
      await replyOrEditInteraction(interaction, {
        content:
          activeCount > 1 ? multipleActiveGamesHint() : "No active game found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const player = engine
      .getState()
      .players.find((candidate) => candidate.discordUserId === interaction.user.id);
    if (!player) {
      await replyOrEditInteraction(interaction, {
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
      const roles = await resolveGameRoles(interaction.guild, game);
      if (roles) {
        await removeRoleFromUser(interaction.guild, interaction.user.id, roles.playersRole.id);
        if (interaction.guild) {
          await postGameLogRoleChange(
            interaction.guild,
            game,
            "removed",
            interaction.user.id,
            `<@&${roles.playersRole.id}> (player)`,
            interaction.user.id,
          );
        }
      }
      await replyOrEditInteraction(interaction, {
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
      await replyOrEditInteraction(interaction, {
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
      await replyOrEditInteraction(interaction, {
        content: "No active games found in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = games.map(
      (game) => `- \`${game.id}\` in <#${game.channelId}> — phase: **${game.phase}**`,
    );

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Active Grimkeeper games")
          .setDescription(lines.join("\n")),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

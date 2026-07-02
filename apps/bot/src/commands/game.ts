import { randomUUID } from "node:crypto";
import {
  AnyThreadChannel,
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
  Role,
  ThreadAutoArchiveDuration,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  appendGameEvent,
  getActiveGameForGuild,
  getGameEvents,
  prisma,
  type Prisma,
} from "@grimkeeper/database";
import {
  DEV_MIN_PLAYERS,
  DEFAULT_MIN_PLAYERS,
  GameCommandKind,
  GameEngine,
  GameEngineError,
  StandardEdition,
  dealRolesFromScript,
  fakePlayerId,
  fakePlayerName,
  findScriptRole,
  getScriptCompositionText,
  isFakePlayer,
  parseScriptJson,
  resolveStandardScript,
  troubleBrewingRoles,
  type GameEvent,
  type GameScript,
} from "@grimkeeper/engine";

import { canUseBot } from "../access.js";
import { isDevMode, requireDevMode } from "../dev.js";
import { logGameEvent } from "../game-events-log.js";
import { buildRoleDmEmbed, buildRoleEmbed } from "../role-embed.js";

const GAME_DISCORD_ROLES_ENABLED = false;
const STORYTELLER_THREAD_NAME = "ST and the gang";

function resolveRoleQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return troubleBrewingRoles.find(
    (role) =>
      role.id === normalized ||
      role.name.toLowerCase() === normalized ||
      role.name.toLowerCase().replace(/ /g, "_") === normalized,
  );
}

@Discord()
@SlashGroup({ name: "game", description: "Blood on the Clocktower storyteller commands" })
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

    const existing = await getActiveGameForGuild(interaction.guildId);
    if (existing) {
      await interaction.reply({ content: "An active game already exists in this server.", flags: MessageFlags.Ephemeral });
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
      ? " Dev mode: use `/game dev-fill` to add fake players."
      : "";
    const threadHint = storytellerThread
      ? ` Storyteller thread created: ${storytellerThread}.`
      : " I could not create a storyteller thread (missing permissions or unsupported channel type).";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription(
            `Script: **${script.name}** (${script.roles.length} characters).\nPlayers can join with \`/game join\`. Storyteller can start once there are at least ${minPlayers()} players, then set up the grimoire with \`/game grim-setup\`, \`/game deal\`, or \`/game assign\`.${roleHint}${threadHint}${devHint}`,
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

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({ content: "No active game found. Create one with `/game create`.", flags: MessageFlags.Ephemeral });
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

  @Slash({ name: "dev-fill", description: "[Dev] Add fake players to the lobby" })
  async devFill(
    @SlashOption({
      name: "count",
      description: "How many fake players to add (default: fill to min players)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 15,
    })
    count?: number,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const target = count ?? Math.max(0, minPlayers() - engine.getState().players.length);
    if (target === 0) {
      await interaction.reply({ content: `Lobby already has ${engine.getState().players.length} players (min ${minPlayers()}).`, flags: MessageFlags.Ephemeral });
      return;
    }

    const existingFakeCount = engine.getState().players.filter((p) => p.isFake).length;
    const added: string[] = [];

    for (let i = 0; i < target; i++) {
      const index = existingFakeCount + i + 1;
      const playerId = randomUUID();
      const events = engine.handle({
        kind: GameCommandKind.AddPlayer,
        gameId: game.id,
        playerId,
        discordUserId: fakePlayerId(game.id, index),
        displayName: fakePlayerName(index),
      });
      await persistEvents(engine, events);
      await prisma.player.create({
        data: {
          id: playerId,
          gameId: game.id,
          discordUserId: fakePlayerId(game.id, index),
          displayName: fakePlayerName(index),
          seat: engine.getState().players.find((p) => p.id === playerId)?.seat ?? null,
        },
      });
      added.push(fakePlayerName(index));
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Dev players added")
          .setDescription(added.join("\n"))
          .addFields({ name: "Lobby size", value: `${engine.getState().players.length} / ${minPlayers()} min` }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "dev-clear", description: "[Dev] Remove all fake players from the lobby" })
  async devClear(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const fakeCount = engine.getState().players.filter((p) => p.isFake).length;
    if (fakeCount === 0) {
      await interaction.reply({ content: "No fake players in the lobby.", flags: MessageFlags.Ephemeral });
      return;
    }

    const events = engine.handle({ kind: GameCommandKind.ClearFakePlayers, gameId: game.id });
    await persistEvents(engine, events);
    await prisma.player.deleteMany({
      where: { gameId: game.id, discordUserId: { startsWith: "dev:" } },
    });

    await interaction.reply({
      content: `Removed ${fakeCount} fake player(s). Lobby size: ${engine.getState().players.length}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "dev-setup", description: "[Dev] Fill lobby to min players and show role script" })
  async devSetup(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const needed = Math.max(0, minPlayers() - engine.getState().players.length);
    if (needed > 0) {
      const existingFakeCount = engine.getState().players.filter((p) => p.isFake).length;
      for (let i = 0; i < needed; i++) {
        const index = existingFakeCount + i + 1;
        const playerId = randomUUID();
        const events = engine.handle({
          kind: GameCommandKind.AddPlayer,
          gameId: game.id,
          playerId,
          discordUserId: fakePlayerId(game.id, index),
          displayName: fakePlayerName(index),
        });
        await persistEvents(engine, events);
        await prisma.player.create({
          data: {
            id: playerId,
            gameId: game.id,
            discordUserId: fakePlayerId(game.id, index),
            displayName: fakePlayerName(index),
            seat: engine.getState().players.find((p) => p.id === playerId)?.seat ?? null,
          },
        });
      }
    }

    const playerCount = engine.getState().players.length;
    const script = engine.getState().script;
    const compositionText = getScriptCompositionText(playerCount, { devMode: isDevMode() });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Dev setup ready")
          .setDescription(
            `Lobby has ${playerCount} players on **${script?.name ?? "unknown script"}**. Run \`/game start\`, then set up the grimoire.`,
          )
          .addFields(
            { name: "Composition", value: compositionText },
            {
              name: "Players",
              value: engine
                .getState()
                .players.map((p) => `${p.seat}. ${p.displayName}${p.isFake ? " (fake)" : ""}`)
                .join("\n"),
            },
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
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
      await interaction.reply({
        content:
          `Setup started for **${script?.name ?? "your script"}**. ` +
          "Configure the grimoire with `/game grim-setup`, `/game deal`, or `/game assign` + `/game begin-night`.",
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
        content: "Run `/game start` first to enter grimoire setup.",
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
        `Assign **${playerCount}** roles from this script.\nComposition: ${compositionText}\n\nUse \`/game assign\` to place roles manually, \`/game deal\` to randomize, then \`/game begin-night\` when ready.`,
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

  @Slash({ name: "nominate", description: "Nominate another player for execution" })
  async nominate(
    @SlashOption({
      name: "player",
      description: "Player to nominate",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player: nominator } = context;
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
      });
      await persistEvents(engine, events);

      await interaction.reply({
        content: `<@${nominator.discordUserId}> nominates <@${target.discordUserId}> for execution.`,
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

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
      return;
    }

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    if (state.phase !== "day") {
      await interaction.reply({
        content: "There is no open nomination phase right now.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (state.nominations.length === 0) {
      await interaction.reply({
        content: `Day ${state.dayNumber}: no nominations yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = state.nominations.map((nomination) => {
      const nominator = engine.getPlayerById(nomination.nominatorId);
      const nominee = engine.getPlayerById(nomination.nomineeId);
      return `<@${nominator?.discordUserId ?? "unknown"}> → <@${nominee?.discordUserId ?? "unknown"}>`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Day ${state.dayNumber} nominations`)
          .setDescription(lines.join("\n")),
      ],
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
      await interaction.reply({
        content: `Game ended. ${winner} wins: ${reason}${cleanupHint}.${threadHint}`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }
}

function minPlayers(): number {
  return isDevMode() ? DEV_MIN_PLAYERS : DEFAULT_MIN_PLAYERS;
}

async function loadScriptForCreate(
  edition: string | undefined,
  scriptUrl: string | undefined,
): Promise<GameScript> {
  if (scriptUrl?.trim()) {
    const response = await fetch(scriptUrl.trim());
    if (!response.ok) {
      throw new Error(`Could not fetch script JSON (HTTP ${response.status}).`);
    }
    const json: unknown = await response.json();
    return parseScriptJson(json, { source: "custom", scriptUrl: scriptUrl.trim() });
  }

  return resolveStandardScript(parseEdition(edition));
}

function parseEdition(value: string | undefined): StandardEdition {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "tb" || normalized === "trouble brewing") {
    return StandardEdition.TB;
  }
  if (normalized === "bmr" || normalized === "bad moon rising") {
    return StandardEdition.BMR;
  }
  if (
    normalized === "snv" ||
    normalized === "sects & violets" ||
    normalized === "sects and violets"
  ) {
    return StandardEdition.SNV;
  }
  throw new Error("Edition must be TB, BMR, or SNV.");
}

async function deliverRolesToPlayers(
  interaction: CommandInteraction,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<string[]> {
  const script = engine.getState().script;
  const roleLines: string[] = [];

  for (const player of engine.getState().players) {
    const roleId = player.roleId ?? "unknown";
    const roleName = script ? (findScriptRole(script, roleId)?.name ?? roleId) : roleId;
    if (isFakePlayer(player.discordUserId) || isDevMode()) {
      roleLines.push(`${player.displayName}: **${roleName}**${player.isFake ? " (fake)" : ""}`);
      continue;
    }

    const playerThread = await createPersonalPlayerThread(
      interaction,
      game.id,
      game.channelId,
      player.discordUserId,
      player.displayName,
    );
    if (playerThread) {
      await playerThread
        .send({
          content: `Your role is ready, <@${player.discordUserId}>.`,
          embeds: [buildRoleDmEmbed(roleId, script)],
        })
        .catch(() => undefined);
      continue;
    }

    const member = await interaction.guild?.members.fetch(player.discordUserId).catch(() => null);
    if (!member) continue;
    await member.send({ embeds: [buildRoleDmEmbed(roleId, script)] }).catch(() => undefined);
  }

  return roleLines;
}

async function loadEngine(gameId: string): Promise<GameEngine> {
  const stored = await getGameEvents(gameId);
  const events = stored.map((event) => event.payload as unknown as GameEvent);
  return GameEngine.fromEvents(gameId, events);
}

function toJson(event: GameEvent): Prisma.InputJsonValue {
  return structuredClone(event) as unknown as Prisma.InputJsonValue;
}

async function persistEvents(engine: GameEngine, events: ReturnType<GameEngine["handle"]>): Promise<void> {
  for (const event of events) {
    engine.apply(event);
    await appendGameEvent(engine.getState().gameId, event.type, toJson(event));
    logGameEvent(engine, event);
  }
}

async function syncGameProjection(gameId: string, engine: GameEngine): Promise<void> {
  const state = engine.getState();
  await prisma.game.update({
    where: { id: gameId },
    data: { phase: state.phase },
  });

  for (const player of state.players) {
    await prisma.player.updateMany({
      where: { id: player.id, gameId },
      data: {
        seat: player.seat,
        roleId: player.roleId,
        alive: player.alive,
      },
    });
  }
}

async function requireStorytellerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game) {
    await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const engine = await loadEngine(game.id);
  if (!engine.isStoryteller(interaction.user.id)) {
    await interaction.reply({ content: "Only storytellers can run this command.", flags: MessageFlags.Ephemeral });
    return null;
  }

  return game;
}

async function requireActivePlayerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game) {
    await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const engine = await loadEngine(game.id);
  const player = engine.getPlayerByDiscordId(interaction.user.id);
  if (!player) {
    await interaction.reply({ content: "You are not in this game.", flags: MessageFlags.Ephemeral });
    return null;
  }

  return { game, engine, player };
}

async function requireCommandAccess(interaction: CommandInteraction): Promise<boolean> {
  const allowed = await canUseBot(interaction);
  if (allowed) return true;

  const message =
    "You are not allowed to use this bot. Ask an admin to add your user ID " +
    "to `ALLOWED_USER_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
  return false;
}

type GameRoles = {
  stRole: Role;
  playersRole: Role;
};

function roleSlugFromChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "game";
}

async function ensureGameRoles(guild: Guild | null, channelId: string): Promise<GameRoles | null> {
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const slug = roleSlugFromChannelName(channel.name);
  const stName = `st-${slug}`;
  const playersName = `p-${slug}`;

  const existing = await getGameRolesByName(guild, stName, playersName);
  if (existing) return existing;

  try {
    const stRole = await guild.roles.create({ name: stName, mentionable: true });
    const playersRole = await guild.roles.create({ name: playersName, mentionable: true });
    return { stRole, playersRole };
  } catch {
    return null;
  }
}

async function getGameRoles(guild: Guild | null, channelId: string): Promise<GameRoles | null> {
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const slug = roleSlugFromChannelName(channel.name);
  return getGameRolesByName(guild, `st-${slug}`, `p-${slug}`);
}

async function getGameRolesByName(
  guild: Guild,
  stName: string,
  playersName: string,
): Promise<GameRoles | null> {
  await guild.roles.fetch();
  const stRole = guild.roles.cache.find((role) => role.name === stName);
  const playersRole = guild.roles.cache.find((role) => role.name === playersName);
  if (!stRole || !playersRole) return null;
  return { stRole, playersRole };
}

async function addRoleToUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await member.roles.add(roleId).catch(() => undefined);
}

async function removeRoleFromUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await member.roles.remove(roleId).catch(() => undefined);
}

async function cleanupGameRoles(guild: Guild | null, channelId: string): Promise<void> {
  if (!guild) return;
  const roles = await getGameRoles(guild, channelId);
  if (!roles) return;

  // Deleting a role removes it from all members automatically.
  await roles.playersRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
  await roles.stRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
}

async function createStorytellerThread(
  interaction: CommandInteraction,
  gameId: string,
): Promise<string | null> {
  const channel = interaction.channel;
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    return null;
  }

  try {
    const thread = await channel.threads.create({
      name: STORYTELLER_THREAD_NAME,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Storyteller thread for game ${gameId}`,
      // discord.js typings can omit these on some channel manager variants.
      ...( {
        type: ChannelType.PrivateThread,
        invitable: false,
      } as Record<string, unknown>),
    });

    await thread.members.add(interaction.user.id).catch(() => undefined);
    await thread.send(
      "Storyteller thread ready. Use this space for private narration and spectator discussion.",
    );
    return `<#${thread.id}>`;
  } catch {
    return null;
  }
}

async function createPersonalPlayerThread(
  interaction: CommandInteraction,
  gameId: string,
  parentChannelId: string,
  userId: string,
  displayName: string,
): Promise<AnyThreadChannel | null> {
  const guild = interaction.guild;
  if (!guild) return null;
  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (
    !parent ||
    (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement)
  ) {
    return null;
  }

  const sanitized = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const shortGameId = gameId.slice(0, 6);
  const threadName = `player-${sanitized || "member"}-${shortGameId}`.slice(0, 100);

  try {
    const thread = await parent.threads.create({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Private player thread for ${displayName} in game ${gameId}`,
      ...( {
        type: ChannelType.PrivateThread,
        invitable: false,
      } as Record<string, unknown>),
    });

    await thread.members.add(userId).catch(() => undefined);
    await thread.send(
      `Hi <@${userId}>! This is your private game thread for Grimkeeper.`,
    );
    return thread;
  } catch {
    return null;
  }
}

function isStorytellerThread(candidate: AnyThreadChannel, parentChannelId: string): boolean {
  return candidate.parentId === parentChannelId && candidate.name === STORYTELLER_THREAD_NAME;
}

async function getStorytellerThread(
  guild: Guild,
  parentChannelId: string,
): Promise<AnyThreadChannel | null> {
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find((candidate) =>
    isStorytellerThread(candidate, parentChannelId),
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (
    !parent ||
    (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement)
  ) {
    return null;
  }

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => isStorytellerThread(candidate, parentChannelId)) ?? null;
}

async function openStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  extraMemberIds: Iterable<string>,
): Promise<AnyThreadChannel | null> {
  const thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread) return null;

  await thread
    .edit({
      archived: false,
      locked: false,
      invitable: true,
      reason: "Game ended; opening storyteller thread for post-game discussion.",
    })
    .catch(() => undefined);

  const memberIds = new Set(extraMemberIds);
  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (parent) {
    const members = await guild.members.fetch().catch(() => null);
    if (members) {
      for (const member of members.values()) {
        if (member.user.bot) continue;
        if (parent.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) {
          memberIds.add(member.id);
        }
      }
    }
  }

  for (const userId of memberIds) {
    await thread.members.add(userId).catch(() => undefined);
  }

  await thread
    .send("Game ended — this thread is now open for post-game discussion.")
    .catch(() => undefined);
  return thread;
}

async function replyEngineError(interaction: CommandInteraction, error: unknown): Promise<void> {
  const message = error instanceof GameEngineError ? error.message : "Unexpected game engine error.";
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

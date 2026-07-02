import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
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
  GameEngine,
  GameEngineError,
  dealTroubleBrewingRoles,
  fakePlayerId,
  fakePlayerName,
  formatRoleName,
  getTroubleBrewingComposition,
  isFakePlayer,
  troubleBrewingRoles,
  type GameEvent,
} from "@grimkeeper/engine";

import { canUseBot } from "../access.js";
import { isDevMode, requireDevMode } from "../dev.js";
import { buildRoleDmEmbed, buildRoleEmbed } from "../role-embed.js";

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
  async create(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({ content: "This command must be used in a server channel.", ephemeral: true });
      return;
    }

    const existing = await getActiveGameForGuild(interaction.guildId);
    if (existing) {
      await interaction.reply({ content: "An active game already exists in this server.", ephemeral: true });
      return;
    }

    const gameId = randomUUID();
    const engine = new GameEngine(gameId);
    const events = engine.handle({
      kind: "CreateGame",
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

    for (const event of events) {
      engine.apply(event);
      await appendGameEvent(gameId, event.type, toJson(event));
    }

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
            `Players can join with \`/game join\`. Storyteller can start once there are at least ${minPlayers()} players.${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "join", description: "Join the active game lobby" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
      return;
    }

    const game = await getActiveGameForGuild(interaction.guildId);
    if (!game) {
      await interaction.reply({ content: "No active game found. Create one with `/game create`.", ephemeral: true });
      return;
    }

    const engine = await loadEngine(game.id);
    const playerId = randomUUID();
    const events = engine.handle({
      kind: "AddPlayer",
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

    await interaction.reply({
      content: `Joined the game. ${engine.getState().players.length} player(s) in lobby.`,
      ephemeral: true,
    });
  }

  @Slash({ name: "dev-fill", description: "[Dev] Add fake players to the lobby" })
  async devFill(
    interaction: CommandInteraction,
    @SlashOption({
      name: "count",
      description: "How many fake players to add (default: fill to min players)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 15,
    })
    count?: number,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", ephemeral: true });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const target = count ?? Math.max(0, minPlayers() - engine.getState().players.length);
    if (target === 0) {
      await interaction.reply({ content: `Lobby already has ${engine.getState().players.length} players (min ${minPlayers()}).`, ephemeral: true });
      return;
    }

    const existingFakeCount = engine.getState().players.filter((p) => p.isFake).length;
    const added: string[] = [];

    for (let i = 0; i < target; i++) {
      const index = existingFakeCount + i + 1;
      const playerId = randomUUID();
      const events = engine.handle({
        kind: "AddPlayer",
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
      ephemeral: true,
    });
  }

  @Slash({ name: "dev-clear", description: "[Dev] Remove all fake players from the lobby" })
  async devClear(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", ephemeral: true });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    const fakeCount = engine.getState().players.filter((p) => p.isFake).length;
    if (fakeCount === 0) {
      await interaction.reply({ content: "No fake players in the lobby.", ephemeral: true });
      return;
    }

    const events = engine.handle({ kind: "ClearFakePlayers", gameId: game.id });
    await persistEvents(engine, events);
    await prisma.player.deleteMany({
      where: { gameId: game.id, discordUserId: { startsWith: "dev:" } },
    });

    await interaction.reply({
      content: `Removed ${fakeCount} fake player(s). Lobby size: ${engine.getState().players.length}.`,
      ephemeral: true,
    });
  }

  @Slash({ name: "dev-setup", description: "[Dev] Fill lobby to min players and show role script" })
  async devSetup(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    try {
      requireDevMode();
    } catch {
      await interaction.reply({ content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.", ephemeral: true });
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
          kind: "AddPlayer",
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
    const composition = getTroubleBrewingComposition(playerCount, { devMode: isDevMode() });
    const compositionText = Object.entries(composition)
      .map(([type, count]) => `${type}: ${count}`)
      .join(" · ");

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Dev setup ready")
          .setDescription(`Lobby has ${playerCount} players. Run \`/game start\` to deal Trouble Brewing roles.`)
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
      ephemeral: true,
    });
  }

  @Slash({ name: "role", description: "Show a Trouble Brewing role with official art" })
  async role(
    interaction: CommandInteraction,
    @SlashOption({
      name: "name",
      description: "Role name (e.g. Washerwoman, Fortune Teller, Imp)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    roleQuery: string,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    const role = resolveRoleQuery(roleQuery);
    if (!role) {
      await interaction.reply({
        content: `Unknown role "${roleQuery}". Try names like Washerwoman, Fortune Teller, or Imp.`,
        ephemeral: true,
      });
      return;
    }

    const embed = buildRoleEmbed(role.id);
    if (!embed) {
      await interaction.reply({ content: "Unknown role.", ephemeral: true });
      return;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
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
      ephemeral: true,
    });
  }

  @Slash({ name: "start", description: "Deal roles and begin night 1" })
  async start(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const playerCount = engine.getState().players.length;
      const roleIds = dealTroubleBrewingRoles(playerCount, { devMode: isDevMode() });
      const events = engine.handle({
        kind: "StartGame",
        gameId: game.id,
        roleAssignments: engine.getState().players.map((player, index) => ({
          playerId: player.id,
          roleId: roleIds[index]!,
        })),
        minPlayers: minPlayers(),
      });

      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const roleLines: string[] = [];
      for (const player of engine.getState().players) {
        const roleId = player.roleId ?? "unknown";
        const roleName = formatRoleName(roleId);
        if (isFakePlayer(player.discordUserId) || isDevMode()) {
          roleLines.push(`${player.displayName}: **${roleName}**${player.isFake ? " (fake)" : ""}`);
          continue;
        }
        const member = await interaction.guild?.members.fetch(player.discordUserId).catch(() => null);
        if (!member) continue;
        await member
          .send({ embeds: [buildRoleDmEmbed(roleId)] })
          .catch(() => undefined);
      }

      const replyContent = isDevMode()
        ? "Roles dealt. Night 1 has begun.\n\n" + roleLines.join("\n")
        : "Roles dealt privately. Night 1 has begun.";

      await interaction.reply({ content: replyContent, ephemeral: true });
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
      const events = engine.handle({ kind: "AdvancePhase", gameId: game.id, targetPhase: "night" });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      await interaction.reply({ content: `Night ${engine.getState().nightNumber} started.`, ephemeral: true });
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
      const events = engine.handle({ kind: "AdvancePhase", gameId: game.id, targetPhase: "day" });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      await interaction.reply({ content: `Day ${engine.getState().dayNumber} started.`, ephemeral: true });
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
    interaction: CommandInteraction,
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
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({ kind: "EndGame", gameId: game.id, winner, reason });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);
      await interaction.reply({ content: `Game ended. ${winner} wins: ${reason}` });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }
}

function minPlayers(): number {
  return isDevMode() ? DEV_MIN_PLAYERS : DEFAULT_MIN_PLAYERS;
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
    await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game) {
    await interaction.reply({ content: "No active game found.", ephemeral: true });
    return null;
  }

  const engine = await loadEngine(game.id);
  if (engine.getState().storytellerId !== interaction.user.id) {
    await interaction.reply({ content: "Only the storyteller can run this command.", ephemeral: true });
    return null;
  }

  return game;
}

async function requireCommandAccess(interaction: CommandInteraction): Promise<boolean> {
  const allowed = await canUseBot(interaction);
  if (allowed) return true;

  const message =
    "You are not allowed to use this bot. Ask an admin to add your user ID " +
    "to `ALLOWED_USER_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, ephemeral: true });
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
  return false;
}

async function createStorytellerThread(
  interaction: CommandInteraction,
  gameId: string,
): Promise<string | null> {
  const channel = interaction.channel;
  if (!channel || !("threads" in channel)) {
    return null;
  }

  try {
    const thread = await channel.threads.create({
      name: `grimkeeper-${gameId.slice(0, 8)}-storyteller`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Storyteller thread for game ${gameId}`,
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

async function replyEngineError(interaction: CommandInteraction, error: unknown): Promise<void> {
  const message = error instanceof GameEngineError ? error.message : "Unexpected game engine error.";
  await interaction.reply({ content: message, ephemeral: true });
}

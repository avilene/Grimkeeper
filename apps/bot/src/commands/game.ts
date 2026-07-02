import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  appendGameEvent,
  getActiveGameForGuild,
  getGameEvents,
  prisma,
  type Prisma,
} from "@grimkeeper/database";
import { GameEngine, GameEngineError, dealRoles, type GameEvent } from "@grimkeeper/engine";

@Discord()
@SlashGroup({ name: "game", description: "Blood on the Clocktower storyteller commands" })
@SlashGroup("game")
export class GameCommands {
  @Slash({ name: "create", description: "Create a new game in this channel" })
  async create(interaction: CommandInteraction): Promise<void> {
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

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription("Players can join with `/game join`. Storyteller can start once there are at least 5 players.")
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  @Slash({ name: "join", description: "Join the active game lobby" })
  async join(interaction: CommandInteraction): Promise<void> {
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

  @Slash({ name: "start", description: "Deal roles and begin night 1" })
  async start(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const roleIds = dealRoles(engine.getState().players.length);
      const events = engine.handle({
        kind: "StartGame",
        gameId: game.id,
        roleAssignments: engine.getState().players.map((player, index) => ({
          playerId: player.id,
          roleId: roleIds[index] ?? "washerwoman",
        })),
      });

      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      for (const player of engine.getState().players) {
        if (player.discordUserId === interaction.user.id)  continue;
        // Role DMs are best-effort; guild members may have DMs disabled.
        const member = await interaction.guild?.members.fetch(player.discordUserId).catch(() => null);
        if (!member) continue;
        await member
          .send(`Your role: **${player.roleId}**. Keep it secret until the Grim Reveal.`)
          .catch(() => undefined);
      }

      await interaction.reply({
        content: "Roles dealt privately. Night 1 has begun.",
        ephemeral: true,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "night", description: "Advance to the next night" })
  async night(interaction: CommandInteraction): Promise<void> {
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

async function replyEngineError(interaction: CommandInteraction, error: unknown): Promise<void> {
  const message = error instanceof GameEngineError ? error.message : "Unexpected game engine error.";
  await interaction.reply({ content: message, ephemeral: true });
}

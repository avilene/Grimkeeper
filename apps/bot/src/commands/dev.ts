import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { prisma } from "@grimkeeper/database";
import {
  GameCommandKind,
  fakePlayerId,
  fakePlayerName,
  getScriptCompositionText,
} from "@grimkeeper/engine";

import { isDevMode, requireDevMode } from "../dev.js";
import {
  formatDayStatus,
  loadEngine,
  minPlayers,
  persistEvents,
  replyEngineError,
  requireCommandAccess,
  requireStorytellerGame,
} from "./command-context.js";
import {
  runDevDayStart,
  runDevKill,
  runDevNominate,
  runSetPlayerVote,
} from "../set-vote.js";

@Discord()
@SlashGroup({ name: "dev", description: "Development utilities (DEV_MODE only)" })
@SlashGroup("dev")
export class DevCommands {
  @Slash({ name: "fill", description: "Add fake players to the lobby" })
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

  @Slash({ name: "clear", description: "Remove all fake players from the lobby" })
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

  @Slash({ name: "setup", description: "Fill lobby to min players and show role script" })
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
            `Lobby has ${playerCount} players on **${script?.name ?? "unknown script"}**. Run \`/st start\`, then set up the grimoire.`,
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

  @Slash({ name: "day", description: "Start the next day (dev shortcut with fake-player support)" })
  async devDay(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!(await this.requireDev(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild || !interaction.channelId) return;

    await runDevDayStart({
      interaction,
      gameId: game.id,
      channelId: game.channelId,
      guild,
    });
  }

  @Slash({ name: "day-status", description: "Show nominations, votes, and day state" })
  async devDayStatus(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!(await this.requireDev(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    const engine = await loadEngine(game.id);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Day status")
          .setDescription(formatDayStatus(engine)),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "nominate", description: "Record a nomination by seat (for fake players)" })
  async devNominate(
    @SlashOption({
      name: "nominator_seat",
      description: "Seat of the nominator",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    nominatorSeat: number,
    @SlashOption({
      name: "nominee_seat",
      description: "Seat of the nominee",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    nomineeSeat: number,
    @SlashOption({
      name: "accusation",
      description: "Accusation text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    accusation: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;
    if (!(await this.requireDev(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    await runDevNominate({
      interaction,
      gameId: game.id,
      guild: interaction.guild,
      nominatorSeat,
      nomineeSeat,
      accusation,
    });
  }

  @Slash({ name: "set-vote", description: "Manually set a vote by seat (for fake players)" })
  async devSetVote(
    @SlashOption({
      name: "voter_seat",
      description: "Seat of the voter",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    voterSeat: number,
    @SlashOption({
      name: "nominee_seat",
      description: "Seat of the nominee",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    nomineeSeat: number,
    @SlashOption({
      name: "choice",
      description: "Vote to record",
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
    if (!(await this.requireDev(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    await runSetPlayerVote({
      interaction,
      gameId: game.id,
      guild: interaction.guild,
      voterSeat,
      nomineeSeat,
      choice,
      reason: reason ?? null,
    });
  }

  @Slash({ name: "kill", description: "Mark a player dead by seat (testing night kills / ghost votes)" })
  async devKill(
    @SlashOption({
      name: "seat",
      description: "Seat of the player to kill",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 15,
    })
    seat: number,
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
    if (!(await this.requireDev(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    await runDevKill({
      interaction,
      gameId: game.id,
      seat,
      cause: cause?.trim() || "night",
    });
  }

  private async requireDev(interaction: CommandInteraction): Promise<boolean> {
    try {
      requireDevMode();
      return true;
    } catch {
      await interaction.reply({
        content: "Dev mode is disabled. Set `DEV_MODE=true` in your environment.",
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
  }
}

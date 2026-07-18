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

  @Slash({
    name: "reminders",
    description: "List or cancel pending reminders across the whole server",
  })
  async reminders(
    @SlashOption({
      name: "delete",
      description: "Cancel one reminder by ID prefix from the list",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    deleteId: string | undefined,
    @SlashOption({
      name: "clear_all",
      description: "Cancel every pending reminder in this server",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearAll: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!(await this.requireDev(interaction))) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const {
      cancelAllPendingRemindersForGuild,
      cancelReminderByIdPrefixInGuild,
      listPendingRemindersForGuild,
    } = await import("@grimkeeper/database");
    const {
      discordRelativeWithTime,
      formatPingRoleMentions,
      formatReminderText,
    } = await import("../reminder-message.js");

    if (clearAll) {
      const cancelled = await cancelAllPendingRemindersForGuild(interaction.guildId);
      await interaction.reply({
        content:
          cancelled === 0
            ? "No pending reminders to cancel."
            : `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"} across this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (deleteId?.trim()) {
      const cancelled = await cancelReminderByIdPrefixInGuild(
        interaction.guildId,
        deleteId.trim(),
      );
      await interaction.reply({
        content:
          cancelled === 0
            ? `No pending reminder found with ID prefix \`${deleteId.trim()}\`.`
            : `Cancelled **${cancelled}** reminder${cancelled === 1 ? "" : "s"}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const pending = await listPendingRemindersForGuild(interaction.guildId);
    if (pending.length === 0) {
      await interaction.reply({
        content: "No pending reminders in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = pending.slice(0, 40).map((reminder) => {
      const when = discordRelativeWithTime(reminder.fireAt);
      const pingMentions = reminder.pingPlayers
        ? formatPingRoleMentions(reminder.pingRoleId)
        : null;
      const pingNote = reminder.pingPlayers ? ` ping ${pingMentions ?? "players"}` : "";
      const gameNote = reminder.gameId ? ` game \`${reminder.gameId.slice(0, 8)}\`` : " channel";
      return `- \`${reminder.id.slice(0, 8)}\` ${when} in <#${reminder.channelId}>${gameNote}${pingNote}: ${formatReminderText(reminder.message, reminder.emoji)}`;
    });
    const truncated =
      pending.length > 40 ? `\n\n_…and ${pending.length - 40} more._` : "";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Pending reminders (server-wide)")
          .setDescription(
            `${lines.join("\n")}${truncated}\n\nDelete one: \`/dev reminders delete:<prefix>\`. Clear all: \`/dev reminders clear_all:True\`.\nOther STs manage only their game via \`/st reminders\`.`,
          ),
      ],
      flags: MessageFlags.Ephemeral,
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

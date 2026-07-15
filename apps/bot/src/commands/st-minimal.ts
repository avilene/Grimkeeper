import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { prisma } from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import { minPlayersForMode } from "../bot-mode.js";
import { formatVoteVisibility } from "../day-thread.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import { upsertStVoteTracker } from "../st-vote-tracker.js";
import { runSetPlayerVote } from "../set-vote.js";
import { parseUserMentionsFromString } from "../town-setup.js";
import {
  GAME_DISCORD_ROLES_ENABLED,
  addRoleToUser,
  cleanupGameRoles,
  createPlayerStThreads,
  createTownVoteThread,
  getGameRoles,
  getStorytellerThread,
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  removeRoleFromUser,
  replyEngineError,
  replyOrEditInteraction,
  requireCommandAccess,
  requireStorytellerGame,
  resolveVotingChannel,
  syncGameProjection,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StCommandsMinimal {
  @Slash({ name: "start", description: "Start the game and create private ST threads for each player" })
  async start(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.StartGame,
        gameId: game.id,
        minPlayers: minPlayersForMode(),
      });

      await persistEvents(engine, events);

      const guild = interaction.guild;
      const threadSummary = guild
        ? await createPlayerStThreads(interaction, game, engine)
        : { created: 0, failed: 0 };

      const threadHint =
        threadSummary.created > 0 || threadSummary.failed > 0
          ? ` Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.`
          : "";

      await replyOrEditInteraction(interaction, {
        content: `Game started.${threadHint}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "end", description: "End the game" })
  async end(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.EndGame,
        gameId: game.id,
        winner: "good",
        reason: "Game ended by storyteller",
      });
      await persistEvents(engine, events);

      if (GAME_DISCORD_ROLES_ENABLED) {
        await cleanupGameRoles(guild, game.channelId);
      }

      const cleanupHint = GAME_DISCORD_ROLES_ENABLED ? " Game roles cleaned up." : "";
      await interaction.reply({
        content: `Game ended.${cleanupHint}`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "add-spectator", description: "Assign spectator role and add user to the kib thread" })
  async addSpectator(
    @SlashOption({
      name: "user",
      description: "User to assign as spectator",
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

    const gameRoles = await getGameRoles(guild, game.channelId);
    if (!gameRoles) {
      await interaction.reply({
        content: "Could not find game roles for this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const isPlayer = engine.getPlayerByDiscordId(user.id);
    const isSt = engine.isStoryteller(user.id);
    if (isPlayer || isSt) {
      await interaction.reply({
        content: "That user is already a player or storyteller in this game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addRoleToUser(guild, user.id, gameRoles.spectatorRole.id);

    const thread = await getStorytellerThread(guild, game.channelId);
    if (thread) {
      await thread.members.add(user.id).catch(() => undefined);
    }

    const threadHint = thread ? ` Added to <#${thread.id}>.` : " Could not add to kib thread.";
    await interaction.reply({
      content: `Assigned spectator role to <@${user.id}>.${threadHint}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "remove-spectator", description: "Remove spectator role from a user" })
  async removeSpectator(
    @SlashOption({
      name: "user",
      description: "User to remove as spectator",
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

    const gameRoles = await getGameRoles(guild, game.channelId);
    if (!gameRoles) {
      await interaction.reply({
        content: "Could not find game roles for this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await removeRoleFromUser(guild, user.id, gameRoles.spectatorRole.id);
    await interaction.reply({
      content: `Removed spectator role from <@${user.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "setup-town",
    description: "Set up town from ordered @mentions, create player threads, and open voting",
  })
  async setupTown(
    @SlashOption({
      name: "players",
      description: "Players in seat order — @mentions separated by spaces",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    playersInput: string,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    const mentionIds = parseUserMentionsFromString(playersInput);
    if (mentionIds.length < minPlayersForMode()) {
      await replyOrEditInteraction(interaction, {
        content: `Provide at least ${minPlayersForMode()} @mentions in seat order.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const players = await Promise.all(
      mentionIds.map(async (discordUserId) => {
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        return {
          playerId: randomUUID(),
          discordUserId,
          displayName: member?.displayName ?? member?.user.username ?? discordUserId,
        };
      }),
    );

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.SetupTown,
        gameId: game.id,
        channelId: game.channelId,
        players,
        minPlayers: minPlayersForMode(),
      });
      await persistEvents(engine, events);

      await prisma.player.deleteMany({ where: { gameId: game.id } });
      if (players.length > 0) {
        await prisma.player.createMany({
          data: engine.getState().players.map((player) => ({
            id: player.id,
            gameId: game.id,
            discordUserId: player.discordUserId,
            displayName: player.displayName,
            seat: player.seat,
            alive: player.alive,
            ghostVoteUsed: player.ghostVoteUsed,
            roleId: player.roleId,
          })),
        });
      }

      if (GAME_DISCORD_ROLES_ENABLED) {
        const roles = await getGameRoles(guild, game.channelId);
        if (roles) {
          for (const player of engine.getState().players) {
            await addRoleToUser(guild, player.discordUserId, roles.playersRole.id);
          }
        }
      }

      const threadSummary = await createPlayerStThreads(interaction, game, engine);

      const voteThread = await createTownVoteThread(guild, game, engine);
      if (voteThread) {
        const openEvents = engine.handle({
          kind: GameCommandKind.OpenDay,
          gameId: game.id,
          discordThreadId: voteThread.id,
        });
        await persistEvents(engine, openEvents);
      }

      await upsertPinnedGameStatus(guild, game.channelId, engine);
      await upsertStVoteTracker(guild, game.channelId, engine);

      await replyOrEditInteraction(interaction, {
        content: [
          `Town set up with **${players.length}** players in <#${game.channelId}>.`,
          engine.getSeatingChart().join("\n"),
          threadSummary.created > 0 || threadSummary.failed > 0
            ? `Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.`
            : "",
          voteThread
            ? `Voting thread: <#${voteThread.id}> — nominate and vote there (or ballot privately in your ST thread).`
            : "Players can `/game nominate` in this channel.",
          "ST vote tracker is pinned in your kib thread — lock votes from there.",
        ]
          .filter(Boolean)
          .join("\n"),
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
        await replyOrEditInteraction(interaction, {
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

      const channel = interaction.guild
        ? await resolveVotingChannel(interaction.guild, game, engine)
        : null;
      if (interaction.guild) {
        await refreshNominationEverywhere(interaction.guild, game, engine, next.id, {
          revealSecret: true,
        });
      }
      if (channel) {
        await channel
          .send(
            `Nomination #${next.order} for **${nominee?.displayName ?? "Unknown"}** ${passed ? "**passed**" : "**failed**"} (${yesVotes}/${livingCount} living, ${tally}).` +
              (passed ? " ST may run `/st execute`." : ""),
          )
          .catch(() => undefined);
      }

      await replyOrEditInteraction(interaction, {
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
        await replyOrEditInteraction(interaction, {
          content: "That user is not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const nomination = engine
        .getState()
        .day?.nominations.find(
          (candidate) =>
            candidate.nomineeId === target.id && candidate.status === "resolved_pass",
        );
      if (!nomination) {
        await replyOrEditInteraction(interaction, {
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

      if (interaction.guild) {
        await refreshNominationEverywhere(interaction.guild, game, engine, nomination.id, {
          revealSecret: true,
        });
      }
      const channel = interaction.guild
        ? await resolveVotingChannel(interaction.guild, game, engine)
        : null;
      if (channel) {
        await channel
          .send(`**${target.displayName}** was executed.`)
          .catch(() => undefined);
      }

      if (interaction.guild) {
        await upsertPinnedGameStatus(interaction.guild, game.channelId, engine);
      }

      await replyOrEditInteraction(interaction, {
        content: `Executed **${target.displayName}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "mark-dead", description: "Mark a player dead or alive (ST correction)" })
  async markDead(
    @SlashOption({
      name: "player",
      description: "Player to update",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    @SlashOption({
      name: "alive",
      description: "Mark alive (true) or dead (false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    alive: boolean | undefined,
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
        await replyOrEditInteraction(interaction, {
          content: "That user is not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const markAlive = alive ?? false;
      const events = engine.handle({
        kind: GameCommandKind.SetPlayerAlive,
        gameId: game.id,
        playerId: target.id,
        alive: markAlive,
      });
      await persistEvents(engine, events);

      if (interaction.guild) {
        await upsertPinnedGameStatus(interaction.guild, game.channelId, engine);
      }

      await replyOrEditInteraction(interaction, {
        content: `Marked **${target.displayName}** as **${markAlive ? "alive" : "dead"}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({
    name: "votes",
    description: "Refresh the ST vote tracker in the kib thread (who voted what + lock buttons)",
  })
  async votes(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);
      const message = await upsertStVoteTracker(interaction.guild, game.channelId, engine);
      const thread = await getStorytellerThread(interaction.guild, game.channelId);
      await replyOrEditInteraction(interaction, {
        content: message
          ? `Vote tracker updated in ${thread ? `<#${thread.id}>` : "your kib thread"}.`
          : "Could not post the vote tracker (is the kib thread available?).",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({
    name: "vote-visibility",
    description: "Set public or secret vote tallies (Organ Grinder mode)",
  })
  async voteVisibility(
    @SlashChoice({ name: "Public tallies", value: "public" })
    @SlashChoice({ name: "Secret tallies", value: "secret" })
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

      const voting = interaction.guild
        ? await resolveVotingChannel(interaction.guild, game, engine)
        : null;
      await voting
        ?.send(`Vote visibility is now **${formatVoteVisibility(mode)}**.`)
        .catch(() => undefined);

      await replyOrEditInteraction(interaction, {
        content: `Vote visibility set to **${formatVoteVisibility(mode)}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
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
      description: "Player casting the vote",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    voter: User | undefined,
    @SlashOption({
      name: "nominee",
      description: "Nominated player",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominee: User | undefined,
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
      nomineeUserId: nominee?.id,
      choice,
      reason: reason ?? null,
    });
  }
}

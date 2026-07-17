import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  Role,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { getActiveGameForGuild, prisma } from "@grimkeeper/database";
import { GameCommandKind, GameEngine } from "@grimkeeper/engine";

import { isDevMode } from "../dev.js";
import { type StandardEditionChoice } from "../edition-choices.js";
import { castVoteFromSlash } from "../interactions/day-vote.js";
import { GAME_DO_ACTIONS, respondDoAutocomplete } from "./action-catalog.js";
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
  resolveGameRoles,
  syncGameProjection,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "game", description: "Player commands for Blood on the Clocktower games" })
@SlashGroup("game")
export class GameCommandsMinimal {
  @Slash({
    name: "do",
    description: "Run a player action (type to filter — avoids a long subcommand list)",
  })
  async do(
    @SlashOption({
      name: "action",
      description: "Action to run (start typing to filter)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondGameDoAutocomplete,
    })
    action: string,
    @SlashChoice({ name: "Trouble Brewing", value: "tb" })
    @SlashChoice({ name: "Bad Moon Rising", value: "bmr" })
    @SlashChoice({ name: "Sects & Violets", value: "snv" })
    @SlashOption({
      name: "edition",
      description: "For create: script edition",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    edition: StandardEditionChoice | undefined,
    @SlashOption({
      name: "player",
      description: "For nominate: player to nominate",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    player: User | undefined,
    @SlashOption({
      name: "accusation",
      description: "For nominate: accusation text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    accusation: string | undefined,
    @SlashOption({
      name: "text",
      description: "For defend: defense text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    text: string | undefined,
    @SlashOption({
      name: "nominee",
      description: "For vote: nominated player",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominee: User | undefined,
    @SlashOption({
      name: "choice",
      description: "For vote: yes / no / conditional",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    choice: "yes" | "no" | "conditional" | undefined,
    @SlashOption({
      name: "reason",
      description: "For conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    @SlashOption({
      name: "st",
      description: "For setup: existing storyteller role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    stRole: Role | undefined,
    @SlashOption({
      name: "player_role",
      description: "For setup: existing player role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    playerRole: Role | undefined,
    @SlashOption({
      name: "kib",
      description: "For setup: existing kib/spectator role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    kibRole: Role | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const normalized = action.trim().toLowerCase();
    const known = GAME_DO_ACTIONS.some((entry) => entry.name === normalized);
    if (!known) {
      await replyOrEditInteraction(interaction, {
        content: `Unknown action \`${action}\`. Start typing after \`action:\` to see options, or use \`/game help\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (normalized) {
      case "setup":
        if (!stRole || !playerRole || !kibRole) {
          await replyOrEditInteraction(interaction, {
            content:
              "`/game do setup` needs `st:`, `player_role:`, and `kib:` — pick existing server roles. Optional `edition:`.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await this.setup(edition, stRole, playerRole, kibRole, interaction);
        return;
      case "create":
        await this.create(edition, interaction);
        return;
      case "join":
        await this.join(interaction);
        return;
      case "leave":
        await this.leave(interaction);
        return;
      case "list":
        await this.list(interaction);
        return;
      case "nominate":
        if (!player) {
          await missingOption(interaction, "player", "nominate");
          return;
        }
        if (!accusation?.trim()) {
          await missingOption(interaction, "accusation", "nominate");
          return;
        }
        await this.nominate(player, accusation, interaction);
        return;
      case "defend":
        if (!text?.trim()) {
          await missingOption(interaction, "text", "defend");
          return;
        }
        await this.defend(text, interaction);
        return;
      case "vote":
        if (!nominee) {
          await missingOption(interaction, "nominee", "vote");
          return;
        }
        if (!choice) {
          await missingOption(interaction, "choice", "vote");
          return;
        }
        await this.vote(nominee, choice, reason, interaction);
        return;
      case "roster":
        await this.roster(interaction);
        return;
      default:
        await replyOrEditInteraction(interaction, {
          content: `Action \`${normalized}\` is not implemented.`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  async setup(
    edition: StandardEditionChoice | undefined,
    stRole: Role,
    playerRole: Role,
    kibRole: Role,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getActiveGameForGuild(interaction.guildId);
    if (existing) {
      await replyOrEditInteraction(interaction, {
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
      await replyOrEditInteraction(interaction, {
        content: message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deferInteractionReply(interaction);

    const gameId = randomUUID();
    const gameRoles = { stRole, playersRole: playerRole, spectatorRole: kibRole };

    await addRoleToUser(interaction.guild, interaction.user.id, stRole.id);
    await applyGameChannelPermissions(
      interaction.guild!,
      interaction.channelId,
      stRole.id,
      playerRole.id,
    );

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
        stRoleId: stRole.id,
        playerRoleId: playerRole.id,
        kibRoleId: kibRole.id,
      },
    });

    await persistEvents(engine, events);

    const kibThread = await createKibThread(interaction, gameId, gameRoles, {
      kibRoleId: kibRole.id,
    });
    const devHint = isDevMode() ? " Dev mode: use `/dev fill` to add fake players." : "";
    const threadHint = kibThread
      ? ` Kib thread created: ${kibThread}.`
      : " I could not create a kib thread (missing permissions or unsupported channel type).";
    const roleHint = ` Roles: <@&${stRole.id}>, <@&${playerRole.id}>, kib <@&${kibRole.id}>.`;

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game set up")
          .setDescription(
            `Script: **${script.name}** (${script.roles.length} characters).\nStoryteller: run \`/st do setup-town\` with ordered @mentions to set up players and open voting.${roleHint}${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  async create(
    edition: StandardEditionChoice | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getActiveGameForGuild(interaction.guildId);
    if (existing) {
      await replyOrEditInteraction(interaction, {
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
      await replyOrEditInteraction(interaction, {
        content: message,
        flags: MessageFlags.Ephemeral,
      });
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

    const devHint = isDevMode() ? " Dev mode: use `/dev fill` to add fake players." : "";
    const threadHint = isDevMode()
      ? ""
      : " Prefer `/game do setup` with your existing ST, player, and kib roles.";

    await replyOrEditInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Grimkeeper game created")
          .setDescription(
            `Script: **${script.name}** (${script.roles.length} characters).\nStoryteller: run \`/st do setup-town\` with ordered @mentions to set up players and open voting.${roleHint}${threadHint}${devHint}`,
          )
          .addFields({ name: "Game ID", value: gameId }),
      ],
    });
  }

  async join(interaction: CommandInteraction): Promise<void> {
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
        content: "No active game found. Create one with `/game do setup`.",
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
    }
    await replyOrEditInteraction(interaction, {
      content: `Joined the game. ${engine.getState().players.length} player(s) in lobby.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async leave(interaction: CommandInteraction): Promise<void> {
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
      }
      await replyOrEditInteraction(interaction, {
        content: `You left the lobby. ${engine.getState().players.length} player(s) remain.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async list(interaction: CommandInteraction): Promise<void> {
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

  async nominate(
    nominee: User,
    accusation: string,
    interaction: CommandInteraction,
  ): Promise<void> {
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

  async defend(defenseText: string, interaction: CommandInteraction): Promise<void> {
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

  async vote(
    nominee: User,
    choice: "yes" | "no" | "conditional",
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
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

  async roster(interaction: CommandInteraction): Promise<void> {
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
        content: "Town is not set up yet. Storyteller must run `/st do setup-town`.",
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

async function respondGameDoAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await respondDoAutocomplete(interaction, GAME_DO_ACTIONS);
}

async function missingOption(
  interaction: CommandInteraction,
  option: string,
  action: string,
): Promise<void> {
  await replyOrEditInteraction(interaction, {
    content: `\`/game do ${action}\` needs \`${option}:\`. See \`/game help\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

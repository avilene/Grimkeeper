import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { prisma } from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import { minPlayersForMode } from "../bot-mode.js";
import { formatVoteVisibility } from "../day-thread.js";
import { ensureLogThread, postGameLog, postGameLogRoleChange } from "../game-log-thread.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import { runSetPlayerVote } from "../set-vote.js";
import { upsertStControlPanel } from "../st-control-panel.js";
import { upsertStVoteTracker } from "../st-vote-tracker.js";
import { parseUserMentionsFromString } from "../town-setup.js";
import { closeTownNominations, advanceTownPhase } from "../town-day.js";
import {
  ensureTownSurfaceThreads,
  markTownSurfaceThread,
  parseTownSurfaceKind,
  postDayMarkersToTownSurfaces,
  reloadTownSurfaceGame,
} from "../town-surfaces.js";
import { respondDoAutocomplete, resolveDoActionName, ST_DO_ACTIONS } from "./action-catalog.js";
import { resolveOrCreatePlayerAlias } from "./alias.js";
import {
  addRoleToUser,
  broadcastToPlayerThreads,
  createPlayerStThreads,
  createTownVoteThread,
  finalizeMinimalGameEnd,
  getKibThreadForGame,
  loadEngine,
  persistEvents,
  postNominationEverywhere,
  refreshNominationEverywhere,
  refreshAllNominationEverywhere,
  removeRoleFromUser,
  replyEngineError,
  replyOrEditInteraction,
  requireCommandAccess,
  requireKibThread,
  requireStorytellerGame,
  resolveGameRoles,
  resolveVotingChannel,
  setInteractionProgress,
  syncGameProjection,
} from "./command-context.js";

@Discord()
@SlashGroup({ name: "st", description: "Storyteller commands for an active game" })
@SlashGroup("st")
export class StCommandsMinimal {
  @Slash({
    name: "do",
    description: "Run a storyteller action (type to filter — avoids a long subcommand list)",
  })
  async do(
    @SlashOption({
      name: "action",
      description: "Action to run (start typing to filter)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondStDoAutocomplete,
    })
    action: string,
    @SlashOption({
      name: "player",
      description: "Target player (execute, mark-dead)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    player: User | undefined,
    @SlashOption({
      name: "user",
      description: "Target user (add-st, add/remove spectator)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | undefined,
    @SlashOption({
      name: "players",
      description: "Ordered @mentions for setup-town",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    players: string | undefined,
    @SlashOption({
      name: "alive",
      description: "For mark-dead: true = alive, false = dead (default false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    alive: boolean | undefined,
    @SlashChoice({ name: "Public tallies", value: "public" })
    @SlashChoice({ name: "Secret tallies", value: "secret" })
    @SlashOption({
      name: "mode",
      description: "For vote-visibility: public or secret",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    mode: "public" | "secret" | undefined,
    @SlashOption({
      name: "choice",
      description: "For set-vote: yes / no / conditional",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    choice: "yes" | "no" | "conditional" | undefined,
    @SlashOption({
      name: "voter",
      description: "For set-vote: who is voting",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    voter: User | undefined,
    @SlashOption({
      name: "nominee",
      description: "For set-vote / nominate: nominated player",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominee: User | undefined,
    @SlashOption({
      name: "nominator",
      description: "For nominate: player making the nomination",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominator: User | undefined,
    @SlashOption({
      name: "accusation",
      description: "For nominate: accusation text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    accusation: string | undefined,
    @SlashOption({
      name: "override",
      description: "For nominate: allow re-nominating today",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    override: boolean | undefined,
    @SlashOption({
      name: "reason",
      description: "For set-vote conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    @SlashOption({
      name: "message",
      description: "For say: text to broadcast to all player threads",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | undefined,
    @SlashChoice({ name: "Good wins", value: "good" })
    @SlashChoice({ name: "Evil wins", value: "evil" })
    @SlashOption({
      name: "winner",
      description: "For end: which team won",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    winner: "good" | "evil" | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    if (!(await requireCommandAccess(interaction))) return;

    const normalized = resolveDoActionName(action, ST_DO_ACTIONS);
    if (!normalized) {
      await replyOrEditInteraction(interaction, {
        content: `Unknown action \`${action}\`. Start typing after \`action:\` to see options, or use \`/st help\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (normalized) {
      case "start":
        await this.start(interaction);
        return;
      case "end":
        if (!winner) {
          await missingOption(interaction, "winner", "end");
          return;
        }
        await this.end(winner, interaction);
        return;
      case "add-spectator":
        if (!user) {
          await missingOption(interaction, "user", "add-spectator");
          return;
        }
        await this.addSpectator(user, interaction);
        return;
      case "remove-spectator":
        if (!user) {
          await missingOption(interaction, "user", "remove-spectator");
          return;
        }
        await this.removeSpectator(user, interaction);
        return;
      case "add-st":
        if (!user) {
          await missingOption(interaction, "user", "add-st");
          return;
        }
        await this.addSt(user, interaction);
        return;
      case "setup-town":
        if (!players?.trim()) {
          await missingOption(interaction, "players", "setup-town");
          return;
        }
        await this.setupTown(players, interaction);
        return;
      case "say":
        if (!message?.trim()) {
          await missingOption(interaction, "message", "say");
          return;
        }
        await this.say(message, interaction);
        return;
      case "log":
        await this.log(interaction);
        return;
      case "recreate-threads":
        await this.recreateThreads(interaction);
        return;
      case "resolve-next":
        await this.resolveNext(interaction);
        return;
      case "close-nominations":
        await this.closeNominations(interaction);
        return;
      case "next-phase":
      case "next-day":
        await this.nextPhase(interaction);
        return;
      case "execute":
        if (!player) {
          await missingOption(interaction, "player", "execute");
          return;
        }
        await this.execute(player, interaction);
        return;
      case "mark-dead":
        if (!player) {
          await missingOption(interaction, "player", "mark-dead");
          return;
        }
        await this.markDead(player, alive, interaction);
        return;
      case "votes":
        await this.votes(interaction);
        return;
      case "panel":
        await this.panel(interaction);
        return;
      case "vote-visibility":
        if (!mode) {
          await missingOption(interaction, "mode", "vote-visibility");
          return;
        }
        await this.voteVisibility(mode, interaction);
        return;
      case "set-vote":
        if (!choice) {
          await missingOption(interaction, "choice", "set-vote");
          return;
        }
        await this.setVote(choice, voter, nominee, reason, interaction);
        return;
      case "nominate":
        if (!nominator) {
          await missingOption(interaction, "nominator", "nominate");
          return;
        }
        if (!nominee) {
          await missingOption(interaction, "nominee", "nominate");
          return;
        }
        if (!accusation?.trim()) {
          await missingOption(interaction, "accusation", "nominate");
          return;
        }
        await this.nominateFor(nominator, nominee, accusation, override, interaction);
        return;
      default:
        await replyOrEditInteraction(interaction, {
          content: `Action \`${normalized}\` is not implemented.`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  @Slash({
    name: "mark",
    description: "Mark this thread as Rules, Public Claims, or Whisper Declaration",
  })
  async mark(
    @SlashChoice({ name: "Rules", value: "rules" })
    @SlashChoice({ name: "Public Claims", value: "claims" })
    @SlashChoice({ name: "Whisper Declaration", value: "whisper" })
    @SlashOption({
      name: "surface",
      description: "Which town thread this should be",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    surface: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    const kind = parseTownSurfaceKind(surface);
    if (!kind) {
      await replyOrEditInteraction(interaction, {
        content: "Pick `rules`, `claims`, or `whisper`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isThread()) {
      await replyOrEditInteraction(interaction, {
        content: "Run `/st mark` inside the thread you want to assign.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      if (!engine.getState().townMode) {
        await replyOrEditInteraction(interaction, {
          content: "Mark town threads after `/st setup-town`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { label } = await markTownSurfaceThread(guild, game, engine, kind, channel);
      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> marked <#${channel.id}> as **${label}**.`,
      );
      await replyOrEditInteraction(interaction, {
        content: `Marked <#${channel.id}> as **${label}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not mark that thread.";
      await replyOrEditInteraction(interaction, {
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "panel",
    description: "Post or refresh the ST control panel (buttons) in kib",
  })
  async panel(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);
      const message = await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
      const thread = await getKibThreadForGame(interaction.guild, game);
      await replyOrEditInteraction(interaction, {
        content: message
          ? `ST control panel updated in ${thread ? `<#${thread.id}>` : "kib"}.`
          : "Could not post the control panel (is kib available?).",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({
    name: "add-kib",
    description: "Assign kib role (+ thread access when kib is a thread)",
  })
  async addKib(
    @SlashOption({
      name: "user",
      description: "User to add as kib/spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.addSpectator(user, interaction);
  }

  @Slash({
    name: "remove-kib",
    description: "Remove kib role from a user",
  })
  async removeKib(
    @SlashOption({
      name: "user",
      description: "User to remove from kib/spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.removeSpectator(user, interaction);
  }

  @Slash({
    name: "setup-town",
    description: "Set roster + seats from ordered @mentions (same as /st do setup-town)",
  })
  async setupTownSlash(
    @SlashOption({
      name: "players",
      description: "Ordered @mentions in seat order",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    players: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.setupTown(players, interaction);
  }

  @Slash({
    name: "say",
    description: "Broadcast to all player ST threads from kib (same as /st do say)",
  })
  async saySlash(
    @SlashOption({
      name: "message",
      description: "Text to send to every player ST thread",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    message: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.say(message, interaction);
  }

  @Slash({
    name: "log",
    description: "Create or reopen the ST-only audit log (same as /st do log)",
  })
  async logSlash(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.log(interaction);
  }

  @Slash({
    name: "end",
    description: "End the game and open kib (same as /st do end)",
  })
  async endSlash(
    @SlashChoice({ name: "Good wins", value: "good" })
    @SlashChoice({ name: "Evil wins", value: "evil" })
    @SlashOption({
      name: "winner",
      description: "Which team won",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    winner: "good" | "evil",
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.end(winner, interaction);
  }

  @Slash({
    name: "next-phase",
    description: "Advance night ↔ day (same as /st do next-phase)",
  })
  async nextPhaseSlash(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.nextPhase(interaction);
  }

  @Slash({
    name: "close-nominations",
    description: "Close nominations for the day (same as /st do close-nominations)",
  })
  async closeNominationsSlash(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.closeNominations(interaction);
  }

  @Slash({
    name: "resolve-next",
    description: "Resolve the oldest open nomination (same as /st do resolve-next)",
  })
  async resolveNextSlash(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.resolveNext(interaction);
  }

  @Slash({
    name: "execute",
    description: "Execute a player after a passed nomination (same as /st do execute)",
  })
  async executeSlash(
    @SlashOption({
      name: "player",
      description: "Player to execute",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.execute(player, interaction);
  }

  @Slash({
    name: "mark-dead",
    description: "Mark a player dead or alive (same as /st do mark-dead)",
  })
  async markDeadSlash(
    @SlashOption({
      name: "player",
      description: "Player to mark",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    @SlashOption({
      name: "alive",
      description: "true = alive, false = dead (default false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    alive: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.markDead(player, alive, interaction);
  }

  async start(interaction: CommandInteraction): Promise<void> {
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

  async end(winner: "good" | "evil", interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.EndGame,
        gameId: game.id,
        winner,
        reason: "Game ended by storyteller",
      });
      await persistEvents(engine, events);

      await setInteractionProgress(interaction, "Removing roles and cancelling reminders…");
      await finalizeMinimalGameEnd(guild, game, engine);

      await replyOrEditInteraction(interaction, {
        content:
          `Game ended — **${winner}** wins. Game roles removed from players, reminders cancelled, and kib opened for post-game chat.`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async say(message: string, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;
    if (!(await requireKibThread(interaction, game))) return;

    try {
      const engine = await loadEngine(game.id);
      await setInteractionProgress(interaction, "Broadcasting to player threads…");
      const { sent, failed } = await broadcastToPlayerThreads(
        interaction.guild,
        game,
        engine,
        message.trim(),
        {
          onProgress: async (done, total) => {
            // Avoid hammering editReply on every parallel completion.
            if (done < total && done % 3 !== 0) return;
            await setInteractionProgress(
              interaction,
              `Broadcasting to player threads… (${done}/${total})`,
            );
          },
        },
      );

      if (sent === 0) {
        await replyOrEditInteraction(interaction, {
          content: "No player threads found. Run `/st setup-town` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const failureHint = failed > 0 ? ` (${failed} failed)` : "";
      const preview =
        message.trim().length > 120 ? `${message.trim().slice(0, 117)}…` : message.trim();
      await postGameLog(
        interaction.guild,
        game,
        `<@${interaction.user.id}> broadcast to **${sent}** player thread${sent === 1 ? "" : "s"}${failureHint}: “${preview}”`,
      );
      await replyOrEditInteraction(interaction, {
        content: `Sent to **${sent}** player thread${sent === 1 ? "" : "s"}${failureHint}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async log(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);

      // Resolve kib first — when kib is a channel, the log must nest under that channel.
      const kib = await getKibThreadForGame(interaction.guild, game);
      let kibThreadId = game.kibThreadId ?? null;
      if (kib && kib.id !== game.kibThreadId) {
        kibThreadId = kib.id;
        await prisma.game.update({
          where: { id: game.id },
          data: { kibThreadId },
        });
      } else if (kib) {
        kibThreadId = kib.id;
      }

      const result = await ensureLogThread(
        interaction.guild,
        { ...game, kibThreadId },
        engine,
        { invokerId: interaction.user.id },
      );

      if (result.threadId && result.threadId !== game.logThreadId) {
        await prisma.game.update({
          where: { id: game.id },
          data: { logThreadId: result.threadId },
        });
      }

      if (!result.thread) {
        const parentHint = result.parentId ? ` Parent: <#${result.parentId}>.` : "";
        await replyOrEditInteraction(interaction, {
          content:
            (result.error ??
              "Could not create or find the ST log thread. Check bot permissions (`Manage Threads`) on the kib channel (or town, if kib is a thread).") +
            parentHint,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const parentNote =
        result.parentId && result.parentId !== game.channelId
          ? ` (under kib <#${result.parentId}>)`
          : "";
      // Reply before audit log so a slow sanitize/fetch cannot leave "Working…" stuck
      // (or lose a race that overwrites the success reply).
      await replyOrEditInteraction(interaction, {
        content: `ST log thread ready: <#${result.thread.id}>${result.created ? " (newly created)" : ""}${parentNote}.`,
        flags: MessageFlags.Ephemeral,
      });

      await postGameLog(
        interaction.guild,
        { ...game, kibThreadId, logThreadId: result.threadId },
        `<@${interaction.user.id}> ensured the ST log thread${result.created ? " (created)" : ""}.`,
      );
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async recreateThreads(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      if (!engine.getState().townMode) {
        await replyOrEditInteraction(interaction, {
          content: "Town surfaces are only for town-mode games. Run `/st setup-town` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setInteractionProgress(interaction, "Recreating town threads…");
      const surfaces = await ensureTownSurfaceThreads(guild, game, engine);
      const refreshed = (await reloadTownSurfaceGame(game.id)) ?? game;
      const dayNumber = engine.getState().dayNumber || 1;
      await postDayMarkersToTownSurfaces(guild, refreshed, dayNumber);

      const links = [
        surfaces.whisperDecl ? `Whisper Declaration: <#${surfaces.whisperDecl.id}>` : null,
        surfaces.claims ? `Public Claims: <#${surfaces.claims.id}>` : null,
        surfaces.rules ? `Rules: <#${surfaces.rules.id}>` : null,
      ].filter(Boolean);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> recreated town threads` +
          (links.length > 0 ? ` — ${links.join(", ")}` : "."),
      );

      await replyOrEditInteraction(interaction, {
        content:
          links.length > 0
            ? `Town threads ready:\n${links.join("\n")}`
            : "Could not create town threads. Check bot permissions (`Manage Threads`).",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async addSpectator(user: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const gameRoles = await resolveGameRoles(guild, game);
      if (!gameRoles) {
        await replyOrEditInteraction(interaction, {
          content: "Could not find game roles. Run `/game setup` with ST, player, and kib roles.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const engine = await loadEngine(game.id);
      const isPlayer = engine.getPlayerByDiscordId(user.id);
      const isSt = engine.isStoryteller(user.id);
      if (isPlayer || isSt) {
        await replyOrEditInteraction(interaction, {
          content: "That user is already a player or storyteller in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // REST role assign — no guild.members.fetch (can stall without GuildMembers intent).
      await addRoleToUser(guild, user.id, gameRoles.spectatorRole.id);

      const kib = await getKibThreadForGame(guild, game);
      // Thread membership only applies to kib threads; channel kib uses the role alone.
      if (kib?.isThread()) {
        await kib.members.add(user.id).catch(() => undefined);
      }

      const kibHint = kib
        ? kib.isThread()
          ? ` Added to <#${kib.id}>.`
          : ` Kib channel: <#${kib.id}> (role grants access).`
        : " Could not resolve kib (channel/thread missing).";

      // Reply before audit log so a slow log sanitize/fetch cannot leave "Working…" stuck.
      await replyOrEditInteraction(interaction, {
        content: `Assigned spectator role to <@${user.id}>.${kibHint}`,
        flags: MessageFlags.Ephemeral,
      });

      await postGameLogRoleChange(
        guild,
        game,
        "added",
        user.id,
        `<@&${gameRoles.spectatorRole.id}> (kib)`,
        interaction.user.id,
      );
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async removeSpectator(user: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const gameRoles = await resolveGameRoles(guild, game);
      if (!gameRoles) {
        await replyOrEditInteraction(interaction, {
          content: "Could not find game roles. Run `/game setup` with ST, player, and kib roles.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await removeRoleFromUser(guild, user.id, gameRoles.spectatorRole.id);

      await replyOrEditInteraction(interaction, {
        content: `Removed spectator role from <@${user.id}>.`,
        flags: MessageFlags.Ephemeral,
      });

      await postGameLogRoleChange(
        guild,
        game,
        "removed",
        user.id,
        `<@&${gameRoles.spectatorRole.id}> (kib)`,
        interaction.user.id,
      );
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  /** Promote a co-ST: engine + Discord ST role (+ kib/log access). Does not create a personal player thread. */
  async addSt(user: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      if (engine.isStoryteller(user.id)) {
        await replyOrEditInteraction(interaction, {
          content: "That user is already a storyteller.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.PromoteStoryteller,
        gameId: game.id,
        discordUserId: user.id,
      });
      await persistEvents(engine, events);

      const gameRoles = await resolveGameRoles(guild, game);
      if (gameRoles) {
        await addRoleToUser(guild, user.id, gameRoles.stRole.id);
        await postGameLogRoleChange(
          guild,
          game,
          "added",
          user.id,
          `<@&${gameRoles.stRole.id}> (ST)`,
          interaction.user.id,
        );
      }

      const kib = await getKibThreadForGame(guild, game);
      if (kib?.isThread()) {
        await kib.members.add(user.id).catch(() => undefined);
      }

      if (game.logThreadId) {
        const logThread = await guild.channels.fetch(game.logThreadId).catch(() => null);
        if (logThread?.isThread()) {
          await logThread.members.add(user.id).catch(() => undefined);
        }
      }

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> promoted <@${user.id}> to storyteller.`,
      );

      const accessHints = [
        gameRoles ? "ST role assigned" : "ST role missing — run `/game setup` with roles",
        kib ? `added to <#${kib.id}>` : null,
        game.logThreadId ? `added to <#${game.logThreadId}>` : null,
      ].filter(Boolean);

      await replyOrEditInteraction(interaction, {
        content: `Promoted <@${user.id}> to storyteller (${accessHints.join("; ")}). No personal player thread was created.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async setupTown(playersInput: string, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    const mentionIds = parseUserMentionsFromString(playersInput);
    const minPlayers = minPlayersForMode();
    if (minPlayers > 0 && mentionIds.length < minPlayers) {
      await replyOrEditInteraction(interaction, {
        content: `Provide at least ${minPlayers} @mentions in seat order.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (mentionIds.length === 0) {
      await replyOrEditInteraction(interaction, {
        content: "Provide at least one @mention in seat order.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const players = await Promise.all(
      mentionIds.map(async (discordUserId) => {
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        const discordName =
          member?.displayName ?? member?.user.username ?? discordUserId;
        const displayName = await resolveOrCreatePlayerAlias(
          interaction.guildId!,
          discordUserId,
          discordName,
        );
        return {
          playerId: randomUUID(),
          discordUserId,
          displayName,
        };
      }),
    );

    try {
      await setInteractionProgress(interaction, "Saving roster…");
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

      const roles = await resolveGameRoles(guild, game);
      if (roles) {
        await setInteractionProgress(interaction, "Assigning player roles…");
        for (const player of engine.getState().players) {
          await addRoleToUser(guild, player.discordUserId, roles.playersRole.id);
          await postGameLogRoleChange(
            guild,
            game,
            "added",
            player.discordUserId,
            `<@&${roles.playersRole.id}> (player)`,
            interaction.user.id,
          );
        }
      }

      await setInteractionProgress(interaction, "Creating player threads…");
      const threadSummary = await createPlayerStThreads(interaction, game, engine);

      await setInteractionProgress(interaction, "Opening voting thread…");
      const voteThread = await createTownVoteThread(guild, game, engine);

      await setInteractionProgress(interaction, "Opening town threads…");
      const surfaces = await ensureTownSurfaceThreads(guild, game, engine);

      const { renameTownPhaseSurfaces, postKibPhaseHeader } = await import("../town-day.js");
      const nightNumber = engine.getState().nightNumber || 1;
      await renameTownPhaseSurfaces(
        guild,
        game,
        voteThread?.id ?? null,
        "night",
        nightNumber,
      );

      await postKibPhaseHeader(guild, game, "night", nightNumber);
      if (voteThread) {
        await voteThread
          .send(
            `**Night ${nightNumber}** has begun — nominations open when the storyteller starts Day 1 (\`/st next-phase\`).`,
          )
          .catch(() => undefined);
      }

      await setInteractionProgress(interaction, "Pinning ST panel…");
      await upsertPinnedGameStatus(guild, game.channelId, engine);
      await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

      const playerNames = engine
        .getState()
        .players.map((player) => player.displayName)
        .join(", ");
      const surfaceLinks = [
        surfaces.whisperDecl ? `<#${surfaces.whisperDecl.id}>` : null,
        surfaces.claims ? `<#${surfaces.claims.id}>` : null,
        surfaces.rules ? `<#${surfaces.rules.id}>` : null,
      ].filter(Boolean);
      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> setup-town — **${players.length}** players (${playerNames}).` +
          ` Night **${nightNumber}** (nominations closed).` +
          ` Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.` +
          (voteThread ? ` Voting: <#${voteThread.id}>.` : "") +
          (surfaceLinks.length > 0
            ? ` Town threads: ${surfaceLinks.join(", ")}.`
            : ""),
      );

      await replyOrEditInteraction(interaction, {
        content: [
          `Town set up with **${players.length}** players in <#${game.channelId}>.`,
          `**Night ${nightNumber}** — nominations are closed until Day 1.`,
          engine.getSeatingChart().join("\n"),
          threadSummary.created > 0 || threadSummary.failed > 0
            ? `Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.`
            : "",
          voteThread
            ? `Voting thread: <#${voteThread.id}> — opens for nominations on Day 1 (\`/st next-phase\`).`
            : "Use `/st next-phase` to start Day 1 and open nominations.",
          surfaces.whisperDecl
            ? `Whisper Declaration: <#${surfaces.whisperDecl.id}>`
            : null,
          surfaces.claims ? `Public Claims: <#${surfaces.claims.id}>` : null,
          surfaces.rules
            ? `Rules: <#${surfaces.rules.id}> (ST write-only)`
            : null,
          "ST control panel + vote tracker are pinned in kib.",
        ]
          .filter(Boolean)
          .join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async closeNominations(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);
      const { dayNumber } = await closeTownNominations(
        interaction.guild,
        game,
        engine,
        interaction.user.id,
      );
      await replyOrEditInteraction(interaction, {
        content: `Nominations closed for day **${dayNumber}**. Use \`/st next-phase\` to start night.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async nextPhase(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);
      const { phase, phaseNumber } = await advanceTownPhase(
        interaction.guild,
        game,
        engine,
        interaction.user.id,
      );
      const label = phase === "day" ? "Day" : "Night";
      await replyOrEditInteraction(interaction, {
        content:
          phase === "day"
            ? `${label} **${phaseNumber}** started — nominations are open again.`
            : `${label} **${phaseNumber}** started — nominations are closed until the next day.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async resolveNext(interaction: CommandInteraction): Promise<void> {
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

      const { cancelVoteDeadlineReminder } = await import("../interactions/lock-votes.js");
      await cancelVoteDeadlineReminder(next.id);

      const resolved = engine.getNominationById(next.id);
      const passed = resolved?.status === "resolved_pass";
      const tally = engine.formatNominationTally(next.id, { revealSecret: true });

      const channel = interaction.guild
        ? await resolveVotingChannel(interaction.guild, game, engine)
        : null;
      if (interaction.guild) {
        await refreshAllNominationEverywhere(interaction.guild, game, engine, {
          revealSecret: true,
        });
        await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
      }
      const { formatNominationRef, resolveNominationMessageUrl } = await import("../day-thread.js");
      const nomUrl = await resolveNominationMessageUrl(channel, next.id);
      const nom = formatNominationRef(engine, next.id, nomUrl, { capitalize: true });

      if (interaction.guild) {
        await postGameLog(
          interaction.guild,
          game,
          `<@${interaction.user.id}> resolved ${nom}: **${passed ? "passed" : "failed"}**. ${tally}`,
        );
      }

      await replyOrEditInteraction(interaction, {
        content:
          `${nom} ${passed ? "passed" : "failed"}. ${tally}` +
          (passed ? " Use `/st execute` (or the control panel) if needed." : ""),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async execute(player: User, interaction: CommandInteraction): Promise<void> {
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
        await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
        await postGameLog(
          interaction.guild,
          game,
          `<@${interaction.user.id}> executed <@${target.discordUserId}>.`,
        );
      }

      await replyOrEditInteraction(interaction, {
        content: `Executed **${target.displayName}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async markDead(
    player: User,
    alive: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
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
        await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
        await postGameLog(
          interaction.guild,
          game,
          `<@${interaction.user.id}> marked <@${target.discordUserId}> as **${markAlive ? "alive" : "dead"}**.`,
        );
      }

      await replyOrEditInteraction(interaction, {
        content: `Marked **${target.displayName}** as **${markAlive ? "alive" : "dead"}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async votes(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) return;

    try {
      const engine = await loadEngine(game.id);
      const message = await upsertStVoteTracker(interaction.guild, game.channelId, engine, game.kibThreadId);
      const thread = await getKibThreadForGame(interaction.guild, game);
      await replyOrEditInteraction(interaction, {
        content: message
          ? `Vote tracker updated in ${thread ? `<#${thread.id}>` : "kib"}.`
          : "Could not post the vote tracker (is kib available?).",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async voteVisibility(
    mode: "public" | "secret",
    interaction: CommandInteraction,
  ): Promise<void> {
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

      if (interaction.guild) {
        await postGameLog(
          interaction.guild,
          game,
          `<@${interaction.user.id}> set vote visibility to **${formatVoteVisibility(mode)}**.`,
        );
        await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
      }

      await replyOrEditInteraction(interaction, {
        content: `Vote visibility set to **${formatVoteVisibility(mode)}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async setVote(
    choice: "yes" | "no" | "conditional",
    voter: User | undefined,
    nominee: User | undefined,
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
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

  async nominateFor(
    nominatorUser: User,
    nomineeUser: User,
    accusation: string,
    override: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const nominator = engine.getPlayerByDiscordId(nominatorUser.id);
      const nominee = engine.getPlayerByDiscordId(nomineeUser.id);
      if (!nominator) {
        await replyOrEditInteraction(interaction, {
          content: "That nominator is not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!nominee) {
        await replyOrEditInteraction(interaction, {
          content: "That nominee is not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const allowDuplicate = override === true;
      const events = engine.handle({
        kind: GameCommandKind.MakeNomination,
        gameId: game.id,
        nominatorId: nominator.id,
        nomineeId: nominee.id,
        accusation: accusation.trim(),
        allowDuplicate,
      });
      await persistEvents(engine, events);

      const nominationId = engine.getState().day?.nominations.at(-1)?.id;
      if (interaction.guild && nominationId) {
        const posted = await postNominationEverywhere(
          interaction.guild,
          game,
          engine,
          nominationId,
        );
        await upsertStControlPanel(interaction.guild, game.channelId, engine, game.kibThreadId);
        const voteThreadId = engine.getState().day?.discordThreadId;
        const overrideNote = allowDuplicate ? " (duplicate override)" : "";
        await postGameLog(
          interaction.guild,
          game,
          `<@${interaction.user.id}> nominated for <@${nominator.discordUserId}> → <@${nominee.discordUserId}>${overrideNote}: “${accusation.trim()}”`,
        );
        await replyOrEditInteraction(interaction, {
          content: [
            `Recorded nomination: **${nominator.displayName}** → **${nominee.displayName}**${overrideNote}.`,
            voteThreadId
              ? `Posted in <#${voteThreadId}>${posted.voteThread ? " (players pinged)." : "."}`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await replyOrEditInteraction(interaction, {
        content: `Recorded nomination: **${nominator.displayName}** → **${nominee.displayName}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }
}

async function respondStDoAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await respondDoAutocomplete(interaction, ST_DO_ACTIONS);
}

async function missingOption(
  interaction: CommandInteraction,
  option: string,
  action: string,
): Promise<void> {
  await replyOrEditInteraction(interaction, {
    content: `\`/st do ${action}\` needs \`${option}:\`. See \`/st help\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

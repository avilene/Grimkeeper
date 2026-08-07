import { randomUUID } from "node:crypto";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { prisma, resolveArchiveCategoryId } from "@grimkeeper/database";
import {
  GameCommandKind,
  listBotcRoles,
  defaultBuffetConfig,
  validatePoolForComposition,
  buildInitialPool,
  computeRemainingSlots,
  applySummonerNoDemonSetup,
  formatBuffetDrunkFixLine,
  formatHermitUnchosenOutsidersLine,
  buildClocktowerLiveGamestate,
  serializeClocktowerLiveGamestate,
  type BuffetDraftConfig,
} from "@grimkeeper/engine";

import { minPlayersForMode } from "../bot-mode.js";
import { isDevMode } from "../dev.js";
import { isAllowedUserId } from "../access.js";
import { formatVoteVisibility } from "../day-thread.js";
import { ensureLogThread, postGameLog, postGameLogRoleChange } from "../game-log-thread.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import { log } from "../logger.js";
import { runSetPlayerVote } from "../set-vote.js";
import { upsertStControlPanel } from "../st-control-panel.js";
import { upsertStVoteTracker } from "../st-vote-tracker.js";
import { parseUserMentionsFromString } from "../town-setup.js";
import { closeTownNominations, advanceTownPhase, renameTownPhaseSurfaces, postKibPhaseHeader } from "../town-day.js";
import {
  ensureTownSurfaceThreads,
  markTownSurfaceThread,
  markTownVoteThread,
  parseMarkableTownSurface,
  postDayMarkersToTownSurfaces,
  reloadTownSurfaceGame,
} from "../town-surfaces.js";
import {
  addUserToGameWhispers,
  removeUserFromGameWhispers,
  syncStorytellersToWhisperThreads,
} from "../whisper-thread.js";
import { respondDoAutocomplete, resolveDoActionName, ST_DO_ACTIONS } from "./action-catalog.js";
import { resolveOrCreatePlayerAlias } from "./alias.js";
import {
  addRoleToUser,
  addUserToPlayerStThreads,
  archiveChannelThreadsDirectly,
  archiveGameSurfaces,
  moveChannelToArchiveCategory,
  previewArchiveSurfaces,
  broadcastToPlayerThreads,
  createPlayerStThreads,
  createTownVoteThread,
  ensurePlayerStThread,
  finalizeMinimalGameEnd,
  getKibThreadForGame,
  loadEngine,
  persistEvents,
  postNominationEverywhere,
  refreshNominationEverywhere,
  refreshAllNominationEverywhere,
  removeRoleFromUser,
  removeUserFromPlayerStThreads,
  replyEngineError,
  replyOrEditInteraction,
  deferInteractionReply,
  requireArchivableGame,
  requireCommandAccess,
  requireKibThread,
  requireStorytellerGame,
  resolveGameRoles,
  resolveVotingChannel,
  setInteractionProgress,
  syncGamePlayerRoles,
  syncGameProjection,
  syncStorytellersToPlayerThreads,
} from "./command-context.js";
import { refreshNominationsFromProjection } from "../refresh-noms-from-projection.js";

function resolveBuffetConfigForGame(
  buffetConfig: unknown,
  engineConfig: BuffetDraftConfig | undefined,
): BuffetDraftConfig {
  if (engineConfig) return engineConfig;
  if (buffetConfig && typeof buffetConfig === "object") {
    return buffetConfig as BuffetDraftConfig;
  }
  return defaultBuffetConfig();
}

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
      description: "Target user (add/remove-st, spectator)",
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
    choice: string | undefined,
    @SlashOption({
      name: "voter",
      description: "For set-vote: who is voting",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    voter: User | undefined,
    @SlashOption({
      name: "nominee",
      description: "For set-vote / nominate / ping-missing: nominated player",
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
      name: "recycle",
      description: "For buffet-configure: recycle unchosen roles (true/false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    recycle: boolean | undefined,
    @SlashOption({
      name: "reason",
      description: "For set-vote conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    @SlashOption({
      name: "hours",
      description: "For extend-noms: hours to add to every nomination deadline",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    hours: number | undefined,
    @SlashOption({
      name: "oldplayer",
      description: "For sub: seated player being replaced",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    oldplayer: User | undefined,
    @SlashOption({
      name: "newplayer",
      description: "For sub: Discord user taking the seat",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    newplayer: User | undefined,
    @SlashOption({
      name: "message",
      description: "For broadcast/say: text to send to all player threads",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | undefined,
    @SlashChoice({ name: "Good wins", value: "good" })
    @SlashChoice({ name: "Evil wins", value: "evil" })
    @SlashChoice({ name: "Cancel", value: "cancel" })
    @SlashOption({
      name: "winner",
      description: "For end: which team won",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    winner: "good" | "evil" | "cancel" | undefined,
    @SlashOption({
      name: "dry_run",
      description: "For archive: preview changes without applying them",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    dry_run: boolean | undefined,
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
      case "archive":
        await this.archive(interaction, dry_run ?? false);
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
      case "remove-st":
        if (!user) {
          await missingOption(interaction, "user", "remove-st");
          return;
        }
        await this.removeSt(user, interaction);
        return;
      case "sync-st-threads":
        await this.syncStThreads(interaction);
        return;
      case "sync-player-roles":
        await this.syncPlayerRoles(interaction);
        return;
      case "setup-town":
        if (!players?.trim()) {
          await missingOption(interaction, "players", "setup-town");
          return;
        }
        await this.setupTown(players, interaction);
        return;
      case "broadcast":
      case "say":
        if (!message?.trim()) {
          await missingOption(interaction, "message", normalized);
          return;
        }
        await this.broadcast(message, interaction);
        return;
      case "log":
        await this.log(interaction);
        return;
      case "recreate-threads":
        await this.recreateThreads(interaction);
        return;
      case "recreate-player-thread":
        if (!player) {
          await missingOption(interaction, "player", "recreate-player-thread");
          return;
        }
        await this.recreatePlayerThread(player, interaction);
        return;
      case "reset-to-setup":
        await this.resetToSetup(interaction);
        return;
      case "sub":
        if (!oldplayer) {
          await missingOption(interaction, "oldplayer", "sub");
          return;
        }
        if (!newplayer) {
          await missingOption(interaction, "newplayer", "sub");
          return;
        }
        await this.substitutePlayer(oldplayer, newplayer, interaction);
        return;
      case "resolve-next":
        await this.resolveNext(interaction);
        return;
      case "fail-open-noms":
        await this.failOpenNoms(interaction);
        return;
      case "extend-noms":
        if (hours == null || !Number.isFinite(hours) || hours <= 0) {
          await missingOption(interaction, "hours", "extend-noms");
          return;
        }
        await this.extendNoms(hours, interaction);
        return;
      case "repost-kib-noms":
        await this.repostKibNoms(interaction);
        return;
      case "ping-missing":
        if (!nominee) {
          await missingOption(interaction, "nominee", "ping-missing");
          return;
        }
        await this.pingMissing(nominee, interaction);
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
      case "refresh-noms":
        await this.refreshNoms(interaction);
        return;
      case "buffet-start":
        await this.buffetStart(interaction);
        return;
      case "buffet-status":
        await this.buffetStatus(interaction);
        return;
      case "buffet-cancel":
        await this.buffetCancel(interaction);
        return;
      case "buffet-assign-drunk":
        if (!player) {
          await missingOption(interaction, "player", "buffet-assign-drunk");
          return;
        }
        await this.buffetAssignDrunk(player, interaction);
        return;
      case "buffet-assign-lunatic":
        if (!player) {
          await missingOption(interaction, "player", "buffet-assign-lunatic");
          return;
        }
        await this.buffetAssignLunatic(player, interaction);
        return;
      case "buffet-configure": {
        await this.buffetConfigure(recycle, interaction);
        return;
      }
      case "buffet-export-clocktower":
        await this.buffetExportClocktower(interaction);
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
    description: "Mark this thread as Town Voting, Rules, Public Claims, or Whisper Declaration",
  })
  async mark(
    @SlashChoice({ name: "Town Voting", value: "voting" })
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

    const kind = parseMarkableTownSurface(surface);
    if (!kind) {
      await replyOrEditInteraction(interaction, {
        content: "Pick `voting`, `rules`, `claims`, or `whisper`.",
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

      const { label } =
        kind === "voting"
          ? await markTownVoteThread(game, channel)
          : await markTownSurfaceThread(guild, game, engine, kind, channel);

      // Persist Town Voting on day state when present (day or leftover overnight day).
      if (kind === "voting" && engine.getState().day) {
        const openEvents = engine.handle({
          kind: GameCommandKind.OpenDay,
          gameId: game.id,
          discordThreadId: channel.id,
        });
        await persistEvents(engine, openEvents);
        await syncGameProjection(game.id, engine);
      }

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
          ? `Posted a **new** ST control panel in ${thread ? `<#${thread.id}>` : "kib"} (old panels deleted).`
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
    name: "broadcast",
    description: "Broadcast to all player ST threads from kib",
  })
  async broadcastSlash(
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
    await this.broadcast(message, interaction);
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
    @SlashChoice({ name: "Cancel", value: "cancel" })
    @SlashOption({
      name: "winner",
      description: "Which team won",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    winner: "good" | "evil" | "cancel",
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
    name: "recreate-player-thread",
    description: "Create or reopen one player's private ST thread",
  })
  async recreatePlayerThreadSlash(
    @SlashOption({
      name: "player",
      description: "Player whose ST thread to recreate",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.recreatePlayerThread(player, interaction);
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
    name: "refresh-noms",
    description: "Push nomination/vote DB state to Discord (same as /st do refresh-noms)",
  })
  async refreshNomsSlash(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.refreshNoms(interaction);
  }

  @Slash({
    name: "nominate",
    description: "Nominate on behalf of a player (same as /st do nominate)",
  })
  async nominateSlash(
    @SlashOption({
      name: "nominator",
      description: "Player making the nomination",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominator: User,
    @SlashOption({
      name: "nominee",
      description: "Player being nominated",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    @SlashOption({
      name: "accusation",
      description: "Accusation text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    accusation: string,
    @SlashOption({
      name: "override",
      description: "Allow a second nomination today for nominator and/or nominee",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    override: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.nominateFor(nominator, nominee, accusation, override, interaction);
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
    name: "extend-noms",
    description: "Extend every nomination deadline by N hours (same as /st do extend-noms)",
  })
  async extendNomsSlash(
    @SlashOption({
      name: "hours",
      description: "Hours to add to each nomination's current deadline",
      type: ApplicationCommandOptionType.Number,
      required: true,
    })
    hours: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.extendNoms(hours, interaction);
  }

  @Slash({
    name: "ping-missing",
    description: "Ping all players who have not voted on a nomination",
  })
  async pingMissingSlash(
    @SlashOption({
      name: "nominee",
      description: "Open nominee whose missing voters to ping",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.pingMissing(nominee, interaction);
  }

  @Slash({
    name: "sub",
    description: "Substitute a seated player with another Discord user",
  })
  async subSlash(
    @SlashOption({
      name: "oldplayer",
      description: "Seated player being replaced",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    oldplayer: User,
    @SlashOption({
      name: "newplayer",
      description: "Discord user taking the seat",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    newplayer: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    await this.substitutePlayer(oldplayer, newplayer, interaction);
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

  async end(winner: "good" | "evil" | "cancel", interaction: CommandInteraction): Promise<void> {
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
          `Game ended — **${winner}** wins. Game roles removed from players, reminders cancelled, and kib opened for post-game chat. When ready, \`/st do archive\` freezes town/kib read-only.`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async archive(interaction: CommandInteraction, dryRun = false): Promise<void> {
    const resolved = await requireArchivableGame(interaction);
    if (!resolved) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      await setInteractionProgress(
        interaction,
        dryRun ? "Previewing archive changes…" : "Archiving channels and threads…",
      );

      if (dryRun) {
        const game = resolved.noDbRow ? null : resolved.game;
        const preview = await previewArchiveSurfaces(guild, resolved.channelId, game);
        const lines: string[] = [];

        if (preview.channelLines.length > 0) {
          lines.push("**Channels — permission overwrites:**");
          for (const c of preview.channelLines) {
            lines.push(`• ${c.mention} \`${c.name}\` — ${c.action}`);
          }
        }
        if (preview.threadLines.length > 0) {
          lines.push("");
          lines.push(`**Threads — ${preview.threadLines.length} would be locked:**`);
          for (const t of preview.threadLines) {
            lines.push(`• ${t.mention} \`${t.name}\` — ${t.action}`);
          }
        }
        if (lines.length === 0) {
          lines.push("Nothing found to archive in this channel.");
        }

        await replyOrEditInteraction(interaction, {
          content:
            `**Archive dry run** — no changes made.\n\n${lines.join("\n")}\n\nRun \`/st do archive\` (without \`dry_run\`) to apply.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (resolved.noDbRow) {
        const channelResult = await archiveChannelThreadsDirectly(guild, resolved.channelId);
        const archiveCategoryId = await resolveArchiveCategoryId(guild.id);
        let movedChannels = 0;
        if (archiveCategoryId) {
          if (
            await moveChannelToArchiveCategory(guild, resolved.channelId, archiveCategoryId)
          ) {
            movedChannels++;
          }
        }
        const movedHint =
          movedChannels > 0 ? ` ${movedChannels} channel(s) moved to Archives.` : "";
        const categoryHint = archiveCategoryId
          ? ""
          : " No Archives category configured.";
        await replyOrEditInteraction(interaction, {
          content:
            `Archived unrecognised channel — ${channelResult.threads} thread(s) locked read-only.${movedHint} No game record found, so channel permission overwrites were not applied.${categoryHint}`,
        });
        return;
      }

      const { game } = resolved;
      const result = await archiveGameSurfaces(guild, game);
      const movedHint =
        result.movedChannels > 0
          ? ` ${result.movedChannels} channel(s) moved to Archives.`
          : "";
      await postGameLog(
        guild,
        game,
        `Game archived — town/kib opened for reading; ${result.channels} channel(s) and ${result.threads} thread(s) set read-only.${movedHint}` +
          (interaction.user.id ? ` By <@${interaction.user.id}>.` : ""),
      );

      await replyOrEditInteraction(interaction, {
        content:
          `Archived — town and kib (if a channel) are open to read; ${result.channels} channel(s) and ${result.threads} thread(s) locked read-only.${movedHint} Private ST/whisper threads stay private but locked.`,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async broadcast(message: string, interaction: CommandInteraction): Promise<void> {
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
      const voteThread = await createTownVoteThread(guild, game, engine);
      const surfaces = await ensureTownSurfaceThreads(guild, game, engine);
      const refreshed = (await reloadTownSurfaceGame(game.id)) ?? game;
      const state = engine.getState();
      // Only stamp day markers during an actual day (Night 1 still has dayNumber 0).
      if (state.phase === "day" && state.dayNumber > 0) {
        await postDayMarkersToTownSurfaces(guild, refreshed, state.dayNumber);
      }

      const links = [
        voteThread ? `Town Voting: <#${voteThread.id}>` : null,
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

  /** Create or reopen a single player's private ST thread (and invite STs). */
  async recreatePlayerThread(playerUser: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      log("info", "st.recreate-player-thread.start", {
        gameId: game.id,
        playerId: playerUser.id,
        channelId: interaction.channelId,
      });
      const engine = await loadEngine(game.id);
      if (!engine.getState().townMode) {
        await replyOrEditInteraction(interaction, {
          content: "Player ST threads are for town-mode games. Run `/st setup-town` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const player = engine.getPlayerByDiscordId(playerUser.id);
      if (!player) {
        await replyOrEditInteraction(interaction, {
          content: "That user is not on this game’s roster.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setInteractionProgress(
        interaction,
        `Ensuring ST thread for ${player.displayName}…`,
      );
      const { thread, created } = await ensurePlayerStThread(
        interaction,
        game,
        engine,
        player,
        { announce: true },
      );

      if (!thread) {
        await replyOrEditInteraction(interaction, {
          content: `Could not create an ST thread for **${player.displayName}**. Check bot permissions (\`Create Private Threads\`, \`Manage Threads\`) on the **town** channel.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      log("info", "st.recreate-player-thread.done", {
        gameId: game.id,
        playerId: playerUser.id,
        threadId: thread.id,
        created,
      });

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> ${created ? "created" : "reopened"} player ST thread for <@${player.discordUserId}>: <#${thread.id}>.`,
      );

      await replyOrEditInteraction(interaction, {
        content: created
          ? `Created private ST thread for **${player.displayName}**: <#${thread.id}>.`
          : `Reopened private ST thread for **${player.displayName}**: <#${thread.id}> (player + ST role invited).`,
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

      const playerThreads = await addUserToPlayerStThreads(
        guild,
        game,
        engine,
        user.id,
        "Adding co-ST to player ST thread.",
      );

      const whisperThreads = await addUserToGameWhispers(guild, game.id, user.id);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> promoted <@${user.id}> to storyteller.`,
      );

      const accessHints = [
        gameRoles ? "ST role assigned" : "ST role missing — run `/game setup` with roles",
        kib ? `added to <#${kib.id}>` : null,
        game.logThreadId ? `added to <#${game.logThreadId}>` : null,
        playerThreads.attempted > 0
          ? `added to ${playerThreads.added} player ST thread${playerThreads.added === 1 ? "" : "s"}`
          : null,
        whisperThreads > 0
          ? `added to ${whisperThreads} whisper thread${whisperThreads === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean);

      await replyOrEditInteraction(interaction, {
        content: `Promoted <@${user.id}> to storyteller (${accessHints.join("; ")}). No personal player thread was created.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  /** Demote a co-ST: engine + Discord ST role; remove whisper / player-thread / kib / log access. */
  async removeSt(user: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const state = engine.getState();
      if (state.storytellerId === user.id) {
        await replyOrEditInteraction(interaction, {
          content: "Cannot demote the primary storyteller.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const wasPromoted = state.promotedStorytellerIds.includes(user.id);
      if (wasPromoted) {
        const events = engine.handle({
          kind: GameCommandKind.DemoteStoryteller,
          gameId: game.id,
          discordUserId: user.id,
        });
        await persistEvents(engine, events);
      }

      const gameRoles = await resolveGameRoles(guild, game);
      if (gameRoles) {
        await removeRoleFromUser(guild, user.id, gameRoles.stRole.id);
        await postGameLogRoleChange(
          guild,
          game,
          "removed",
          user.id,
          `<@&${gameRoles.stRole.id}> (ST)`,
          interaction.user.id,
        );
      } else if (!wasPromoted) {
        await replyOrEditInteraction(interaction, {
          content:
            "That user is not a promoted storyteller, and this game has no ST role linked to strip.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const kib = await getKibThreadForGame(guild, game);
      if (kib?.isThread()) {
        await kib.members.remove(user.id).catch(() => undefined);
      }

      if (game.logThreadId) {
        const logThread = await guild.channels.fetch(game.logThreadId).catch(() => null);
        if (logThread?.isThread()) {
          await logThread.members.remove(user.id).catch(() => undefined);
        }
      }

      const playerThreads = await removeUserFromPlayerStThreads(
        guild,
        game,
        engine,
        user.id,
        "Removing co-ST from player ST thread.",
      );

      const whisperThreads = await removeUserFromGameWhispers(guild, game.id, user.id);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> demoted <@${user.id}> from storyteller.`,
      );

      const accessHints = [
        wasPromoted ? "removed from engine ST list" : null,
        gameRoles ? "ST role removed" : null,
        kib?.isThread() ? `removed from <#${kib.id}>` : null,
        game.logThreadId ? `removed from <#${game.logThreadId}>` : null,
        playerThreads.removed > 0
          ? `removed from ${playerThreads.removed} player ST thread${playerThreads.removed === 1 ? "" : "s"}`
          : null,
        whisperThreads > 0
          ? `removed from ${whisperThreads} whisper thread${whisperThreads === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean);

      await replyOrEditInteraction(interaction, {
        content:
          accessHints.length > 0
            ? `Demoted <@${user.id}> (${accessHints.join("; ")}).`
            : `Demoted <@${user.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  /** Invite everyone with the ST role (plus engine STs) into existing player ST and whisper threads. */
  async syncStThreads(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      if (!game.stRoleId) {
        await replyOrEditInteraction(interaction, {
          content: "This game has no ST role linked. Run `/game setup` with an `st:` role first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setInteractionProgress(interaction, "Adding ST role holders to player and whisper threads…");
      const engine = await loadEngine(game.id);
      const { threads } = await syncStorytellersToPlayerThreads(guild, game, engine);
      const whisperThreads = await syncStorytellersToWhisperThreads(guild, game, engine);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> synced ST role holders into **${threads}** player ST thread${threads === 1 ? "" : "s"}` +
          (whisperThreads > 0
            ? ` and **${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`
            : "") +
          `.`,
      );

      const parts: string[] = [];
      if (threads > 0) {
        parts.push(`**${threads}** player ST thread${threads === 1 ? "" : "s"}`);
      }
      if (whisperThreads > 0) {
        parts.push(`**${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`);
      }

      await replyOrEditInteraction(interaction, {
        content:
          parts.length > 0
            ? `Added ST role holders (and engine storytellers) to ${parts.join(" and ")}.`
            : "No player ST or whisper threads found. Run `/st setup-town` (and open whispers) first.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  /** Add the game player role to seated players who are missing it on Discord. */
  async syncPlayerRoles(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      await setInteractionProgress(interaction, "Checking seated players for missing player roles…");
      const engine = await loadEngine(game.id);
      const result = await syncGamePlayerRoles(guild, game, engine);

      if (!result) {
        await replyOrEditInteraction(interaction, {
          content: "This game has no player role linked. Run `/game setup` with a `player_role:` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      for (const userId of result.addedUserIds) {
        await postGameLogRoleChange(
          guild,
          game,
          "added",
          userId,
          `<@&${result.roleId}> (player)`,
          interaction.user.id,
        );
      }

      if (result.addedUserIds.length > 0) {
        await postGameLog(
          guild,
          game,
          `<@${interaction.user.id}> synced player roles — added <@&${result.roleId}> to **${result.addedUserIds.length}** seated player${result.addedUserIds.length === 1 ? "" : "s"}.`,
        );
      }

      const parts: string[] = [];
      if (result.addedUserIds.length > 0) {
        parts.push(
          `added role to **${result.addedUserIds.length}** player${result.addedUserIds.length === 1 ? "" : "s"}`,
        );
      }
      if (result.alreadyHad > 0) {
        parts.push(`**${result.alreadyHad}** already had the role`);
      }
      if (result.failedUserIds.length > 0) {
        parts.push(
          `**${result.failedUserIds.length}** failed (check Manage Roles / hierarchy)`,
        );
      }
      if (result.notInGuildUserIds.length > 0) {
        parts.push(`**${result.notInGuildUserIds.length}** not in this server`);
      }

      await replyOrEditInteraction(interaction, {
        content:
          result.seated === 0
            ? "No real seated players to check (only fake/dev seats?)."
            : parts.length > 0
              ? `Synced player roles for **${result.seated}** seated player${result.seated === 1 ? "" : "s"}: ${parts.join("; ")}.`
              : `Checked **${result.seated}** seated player${result.seated === 1 ? "" : "s"}; nothing to change.`,
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
      await renameTownPhaseSurfaces(guild, game, voteThread?.id ?? null, "setup");
      await postKibPhaseHeader(guild, game, "setup");
      if (voteThread) {
        await voteThread
          .send(
            "**Setup** — roster and seats are locked. Night 1 starts when the storyteller advances the phase.",
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
          ` **Setup** phase.` +
          ` Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.` +
          (voteThread ? ` Voting: <#${voteThread.id}>.` : "") +
          (surfaceLinks.length > 0
            ? ` Town threads: ${surfaceLinks.join(", ")}.`
            : ""),
      );

      await replyOrEditInteraction(interaction, {
        content: [
          `Town set up with **${players.length}** players in <#${game.channelId}>.`,
          "**Setup** — advance the phase when ready for **Night 1** (kib control panel).",
          engine.getSeatingChart().join("\n"),
          threadSummary.created > 0 || threadSummary.failed > 0
            ? `Player threads: ${threadSummary.created} created${threadSummary.failed > 0 ? `, ${threadSummary.failed} failed` : ""}.`
            : "",
          voteThread
            ? `Voting thread: <#${voteThread.id}> — nominations open on Day 1.`
            : "Advance Setup → Night 1 → Day 1 to open nominations.",
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
        content: `Nominations closed for day **${dayNumber}**. Advance the phase to start night.`,
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
            : phaseNumber === 1
              ? `${label} **${phaseNumber}** started — nominations open when Day 1 starts.`
              : `${label} **${phaseNumber}** started — nominations are closed until the next day.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  /** ADMIN_IDS only: wipe day/night progress back to Setup (keeps roster). */
  async resetToSetup(interaction: CommandInteraction): Promise<void> {
    if (!isAllowedUserId(interaction.user.id)) {
      await replyOrEditInteraction(interaction, {
        content:
          "`reset-to-setup` is restricted to `ADMIN_IDS` (user IDs only — roles do not count).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      await setInteractionProgress(interaction, "Resetting town to Setup…");
      const events = engine.handle({
        kind: GameCommandKind.ResetTownToSetup,
        gameId: game.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const voteThreadId =
        (await resolveVotingChannel(guild, game, engine))?.id ?? null;
      await renameTownPhaseSurfaces(guild, game, voteThreadId, "setup");
      await postKibPhaseHeader(guild, game, "setup");

      if (voteThreadId) {
        const voting = await guild.channels.fetch(voteThreadId).catch(() => null);
        if (voting?.isTextBased() && "send" in voting) {
          await voting
            .send(
              "**Setup** — day/night progress was reset. Roster kept. Advance the phase for Night 1.",
            )
            .catch(() => undefined);
        }
      }

      await upsertPinnedGameStatus(guild, game.channelId, engine);
      await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> reset town to **Setup** (roster kept; day/night wiped).`,
      );

      await replyOrEditInteraction(interaction, {
        content:
          "Town reset to **Setup**. Roster kept; day/night progress cleared. Advance the phase for Night 1.",
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
          (passed ? " Use **Execute…** on the control panel if needed." : ""),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async failOpenNoms(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Run this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      const { failAllOpenNominations } = await import("../bulk-nomination-actions.js");
      const result = await failAllOpenNominations(
        interaction.guild,
        game,
        engine,
        interaction.user.id,
      );
      await replyOrEditInteraction(interaction, {
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async extendNoms(hours: number, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Run this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      await replyOrEditInteraction(interaction, {
        content: "`hours` must be a positive number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      const { extendAllNominationDeadlines } = await import("../bulk-nomination-actions.js");
      const result = await extendAllNominationDeadlines(
        interaction.guild,
        game,
        engine,
        hours,
        interaction.user.id,
      );
      await replyOrEditInteraction(interaction, {
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async repostKibNoms(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Run this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      const { repostOpenNominationsToKib } = await import("../bulk-nomination-actions.js");
      const result = await repostOpenNominationsToKib(interaction.guild, game, engine);
      await replyOrEditInteraction(interaction, {
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async pingMissing(nomineeUser: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Run this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const engine = await loadEngine(game.id);
      const target = engine.getPlayerByDiscordId(nomineeUser.id);
      if (!target) {
        await replyOrEditInteraction(interaction, {
          content: "That nominee is not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const open =
        engine
          .getState()
          .day?.nominations.filter(
            (candidate) => candidate.nomineeId === target.id && candidate.status === "open",
          ) ?? [];
      if (open.length === 0) {
        await replyOrEditInteraction(interaction, {
          content: "That player has no open nomination today.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (open.length > 1) {
        await replyOrEditInteraction(interaction, {
          content: "Multiple open nominations for that nominee — use the kib vote tracker **Ping missing** button.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { pingMissingVoters } = await import("../interactions/lock-votes.js");
      const message = await pingMissingVoters(interaction.guild, game, engine, open[0]!.id);
      await replyOrEditInteraction(interaction, {
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async substitutePlayer(
    oldUser: User,
    newUser: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Run this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const { substitutePlayerInGame } = await import("../substitute-player.js");
      const result = await substitutePlayerInGame(
        interaction.guild,
        game,
        oldUser,
        newUser,
        interaction.user.id,
      );
      await replyOrEditInteraction(interaction, {
        content: result.message,
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
      await setInteractionProgress(interaction, "Refreshing vote tracker and nomination embeds…");
      const engine = await loadEngine(game.id);
      await refreshAllNominationEverywhere(interaction.guild, game, engine);
      const thread = await getKibThreadForGame(interaction.guild, game);
      const voting = await resolveVotingChannel(interaction.guild, game, engine);
      await replyOrEditInteraction(interaction, {
        content: [
          `Vote tracker updated in ${thread ? `<#${thread.id}>` : "kib"}.`,
          voting ? `Nomination embeds refreshed in <#${voting.id}>.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async refreshNoms(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Refresh nominations in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await setInteractionProgress(interaction, "Refreshing nominations from the database…");
      const engine = await loadEngine(game.id);
      const result = await refreshNominationsFromProjection(interaction.guild, game, engine);
      await replyOrEditInteraction(interaction, {
        content: [
          `Discord nominations refreshed (${result.total} open today).`,
          result.appended > 0 ? `Synced ${result.appended} projection change(s) into the event log.` : null,
          result.votingChannelId
            ? result.missing > 0
              ? `Recreated ${result.posted}/${result.missing} missing open embed(s) in <#${result.votingChannelId}>.`
              : `No missing open embeds in <#${result.votingChannelId}>.`
            : result.total > 0
              ? "Could not find Town Voting — set Voting thread ID in admin or `/st mark` / recreate-threads."
              : null,
          result.postError && result.posted < result.missing
            ? `Post error: ${result.postError}`
            : null,
          "Existing embeds were updated; kib vote tracker refreshed.",
        ]
          .filter(Boolean)
          .join(" "),
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
        content:
          `Vote visibility set to **${formatVoteVisibility(mode)}**. ` +
          "Players won't see the change until the next nomination.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async setVote(
    choice: string,
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
            posted.voteThread && voteThreadId
              ? `Posted in <#${voteThreadId}> (players pinged).`
              : voteThreadId
                ? `Could not post the nomination embed in <#${voteThreadId}>${posted.error ? `: ${posted.error}` : " — try `/st refresh-noms`."}`
                : "No Town Voting thread is linked for this day — run `/st do recreate-threads` or `/st mark` in Town Voting.",
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

  async buffetStart(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      await setInteractionProgress(interaction, "Starting Sushi Buffet draft…");
      const engine = await loadEngine(game.id);
      const state = engine.getState();

      // Pre-validate pool before issuing command
      const config = state.buffetDraft?.config ?? defaultBuffetConfig();
      const seatedPlayers = state.players.filter((p) => p.seat !== null);
      if (seatedPlayers.length === 0) {
        await replyOrEditInteraction(interaction, {
          content: "No seated players. Run `/st setup-town` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const slots = applySummonerNoDemonSetup(
        computeRemainingSlots(seatedPlayers.length),
        config.enabledRoleIds,
      );
      const pool = buildInitialPool(config.enabledRoleIds);
      const poolError = validatePoolForComposition(pool, slots);
      if (poolError) {
        await replyOrEditInteraction(interaction, {
          content: `Cannot start buffet: ${poolError}\n\nAdjust the role pool in the admin panel (\`/games/${game.id}\`).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check all players have ST threads
      const dbPlayers = await prisma.player.findMany({
        where: { gameId: game.id, seat: { not: null } },
        select: { discordUserId: true, stThreadId: true, displayName: true },
      });
      const missingThreads = dbPlayers.filter((p) => !p.stThreadId);
      if (missingThreads.length > 0) {
        const names = missingThreads.map((p) => p.displayName).join(", ");
        await replyOrEditInteraction(interaction, {
          content: `Missing ST threads for: **${names}**. Run \`/st do recreate-player-thread\` for each player first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.StartBuffetDraft,
        gameId: game.id,
        devMode: isDevMode(),
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const { postBuffetOffer, upsertBuffetDraftTracker } =
        await import("../interactions/buffet-draft.js");

      const draft = engine.getState().buffetDraft;
      const firstOffer = draft?.currentOffer;
      if (draft?.status === "complete") {
        await upsertPinnedGameStatus(guild, game.channelId, engine);
        await upsertBuffetDraftTracker(guild, game, engine).catch(() => undefined);
        await postGameLog(
          guild,
          game,
          `<@${interaction.user.id}> started the Sushi Buffet draft — all picks resolved.`,
        );
        await replyOrEditInteraction(interaction, {
          content: "Sushi Buffet draft complete — all picks resolved.",
        });
      } else if (firstOffer) {
        await postBuffetOffer(guild, game, engine, firstOffer);
        const firstPlayer = engine.getState().players.find((p) => p.id === firstOffer.playerId);
        await upsertPinnedGameStatus(guild, game.channelId, engine);
        await upsertBuffetDraftTracker(guild, game, engine).catch(() => undefined);
        await postGameLog(
          guild,
          game,
          `<@${interaction.user.id}> started the Sushi Buffet draft — first offer for **${firstPlayer?.displayName ?? "a player"}**.`,
        );
        await replyOrEditInteraction(interaction, {
          content: `Sushi Buffet draft started! First offer sent to **${firstPlayer?.displayName ?? "a player"}** in their ST thread.`,
        });
      } else {
        await replyOrEditInteraction(interaction, {
          content: "Draft started but no offer could be generated — check pool configuration.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetStatus(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const draft = engine.getState().buffetDraft;

      if (!draft || draft.status === "idle") {
        await replyOrEditInteraction(interaction, {
          content: "No buffet draft configured. Use the admin panel to set up the role pool, then `/st do buffet-start`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { recreateBuffetDraftTracker } = await import("../interactions/buffet-draft.js");
      const tracker = await recreateBuffetDraftTracker(guild, game, engine).catch(() => null);

      const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));

      if (draft.status === "complete") {
        const pickLines = Object.entries(draft.picks).map(([pid, rid]) => {
          const player = engine.getState().players.find((p) => p.id === pid);
          const role = catalog.get(rid);
          const belief = draft.beliefs[pid];
          const beliefLabel = belief
            ? ` (thinks: ${catalog.get(belief)?.name ?? belief})`
            : "";
          return `• **${player?.displayName ?? pid}** → ${role?.name ?? rid}${beliefLabel}`;
        });
        const drunkLine = formatBuffetDrunkFixLine(draft);
        const hermitLine = formatHermitUnchosenOutsidersLine(draft);
        await replyOrEditInteraction(interaction, {
          content: [
            `**Sushi Buffet — Complete**`,
            ...pickLines,
            ...(hermitLine ? ["", hermitLine] : []),
            ...(drunkLine ? ["", drunkLine] : []),
            "",
            tracker
              ? `Kib draft tracker recreated in <#${tracker.channelId}>.`
              : "Could not post the kib draft tracker (is kib set up?).",
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const currentPlayer = draft.currentOffer
        ? engine.getState().players.find((p) => p.id === draft.currentOffer!.playerId)
        : null;
      const currentSecret = draft.currentOffer
        ? draft.secretAssignments[draft.currentOffer.playerId]
        : undefined;

      const pickLines = Object.entries(draft.picks).map(([pid, rid]) => {
        const player = engine.getState().players.find((p) => p.id === pid);
        const role = catalog.get(rid);
        const belief = draft.beliefs[pid];
        const beliefLabel = belief
          ? ` (thinks: ${catalog.get(belief)?.name ?? belief})`
          : "";
        return `• **${player?.displayName ?? pid}** → ${role?.name ?? rid}${beliefLabel}`;
      });

      const secretLines = Object.entries(draft.secretAssignments).map(([pid, role]) => {
        const player = engine.getState().players.find((p) => p.id === pid);
        const pending = !draft.picks[pid];
        return `• **${player?.displayName ?? pid}** → ${role}${pending ? " (pending pick)" : ""}`;
      });

      const remaining = draft.draftOrder.length - draft.currentIndex;
      const poolCounts = {
        townsfolk: draft.pool.filter((id) => catalog.get(id)?.team === "townsfolk").length,
        outsider: draft.pool.filter((id) => catalog.get(id)?.team === "outsider").length,
        minion: draft.pool.filter((id) => catalog.get(id)?.team === "minion").length,
        demon: draft.pool.filter((id) => catalog.get(id)?.team === "demon").length,
      };

      const slots = draft.remainingSlots;
      const lines = [
        `**Sushi Buffet — In Progress** (${draft.currentIndex}/${draft.draftOrder.length} picked)`,
        `Currently picking: **${currentPlayer?.displayName ?? "—"}**${
          currentSecret
            ? ` _(secret ${currentSecret})_`
            : draft.currentOffer?.offerKind === "lilmonsta-minion"
              ? " _(Lil' Monsta → choose Minion)_"
              : ""
        }`,
        `Remaining: ${remaining} player(s)`,
        `Slots left: TF ${slots.townsfolk}, OS ${slots.outsider}, MN ${slots.minion}, DM ${slots.demon}`,
        draft.inPlayDemon === "lilmonsta" ? "In play (no player): **Lil' Monsta**" : null,
        `Pool: ${draft.pool.length} roles (TF: ${poolCounts.townsfolk}, OS: ${poolCounts.outsider}, MN: ${poolCounts.minion}, DM: ${poolCounts.demon})`,
        "",
        ...(secretLines.length > 0
          ? ["**Secret assignments (ST only):**", ...secretLines, ""]
          : []),
        ...(pickLines.length > 0 ? ["**Picks so far:**", ...pickLines] : ["No picks yet."]),
        "",
        tracker
          ? `Kib draft tracker recreated in <#${tracker.channelId}>.`
          : "Could not post the kib draft tracker (is kib set up?).",
      ].filter((line): line is string => line != null);

      await replyOrEditInteraction(interaction, {
        content: lines.join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetExportClocktower(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      await setInteractionProgress(interaction, "Building clocktower.live export…");
      const engine = await loadEngine(game.id);
      const state = engine.getState();
      const config = resolveBuffetConfigForGame(game.buffetConfig, state.buffetDraft?.config);

      const gamestate = buildClocktowerLiveGamestate({
        config,
        players: state.players.map((player) => ({
          id: player.id,
          displayName: player.displayName,
          seat: player.seat,
          alive: player.alive,
        })),
        draft: state.buffetDraft
          ? {
              picks: state.buffetDraft.picks,
              beliefs: state.buffetDraft.beliefs,
              secretAssignments: state.buffetDraft.secretAssignments,
              inPlayDemon: state.buffetDraft.inPlayDemon,
            }
          : null,
      });

      const json = serializeClocktowerLiveGamestate(gamestate);
      const attachment = new AttachmentBuilder(Buffer.from(json, "utf-8"), {
        name: "grimkeeper-buffet-gamestate.json",
      });

      if (!interaction.deferred && !interaction.replied) {
        await deferInteractionReply(interaction, { ephemeral: true });
      }

      await interaction.editReply({
        content:
          "Import this JSON on [clocktower.live](https://clocktower.live) (**Game → Import**). " +
          "Token roles show what each player believes; reminders show true roles when they differ.",
        files: [attachment],
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetCancel(interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

    try {
      const engine = await loadEngine(game.id);
      const events = engine.handle({
        kind: GameCommandKind.CancelBuffetDraft,
        gameId: game.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> cancelled the Sushi Buffet draft.`,
      );
      await replyOrEditInteraction(interaction, {
        content: "Sushi Buffet draft cancelled. Player roles are unchanged.",
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetAssignDrunk(player: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

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

      const events = engine.handle({
        kind: GameCommandKind.AssignBuffetDrunk,
        gameId: game.id,
        playerId: target.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const draft = engine.getState().buffetDraft;
      const offer = draft?.currentOffer;
      if (offer?.playerId === target.id) {
        const { postBuffetOffer } = await import("../interactions/buffet-draft.js");
        await postBuffetOffer(guild, game, engine, offer);
      }

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> assigned **Drunk** to **${target.displayName}**.`,
      );
      await replyOrEditInteraction(interaction, {
        content: [
          `Assigned **Drunk** to **${target.displayName}**.`,
          offer?.playerId === target.id
            ? "Their current offer was rebuilt with Townsfolk choices."
            : draft?.picks[target.id] === "drunk"
              ? "Their Townsfolk pick was converted (they keep that belief)."
              : "They will see Townsfolk choices on their turn.",
        ].join(" "),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetAssignLunatic(player: User, interaction: CommandInteraction): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;
    const guild = interaction.guild;
    if (!guild) return;

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

      const events = engine.handle({
        kind: GameCommandKind.AssignBuffetLunatic,
        gameId: game.id,
        playerId: target.id,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      const draft = engine.getState().buffetDraft;
      const offer = draft?.currentOffer;
      if (offer?.playerId === target.id) {
        const { postBuffetOffer } = await import("../interactions/buffet-draft.js");
        await postBuffetOffer(guild, game, engine, offer);
      }

      const when =
        draft?.status === "idle"
          ? "They will get Demon choices when the draft starts."
          : offer?.playerId === target.id
            ? "Their current offer was rebuilt with Demon choices."
            : "They will see Demon choices on their turn.";

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> assigned **Lunatic** to **${target.displayName}**.`,
      );
      await replyOrEditInteraction(interaction, {
        content: `Assigned **Lunatic** to **${target.displayName}**. ${when}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  async buffetConfigure(
    recycle: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const game = await requireStorytellerGame(interaction);
    if (!game) return;

    try {
      const engine = await loadEngine(game.id);
      const patch: Record<string, unknown> = {};

      if (recycle !== undefined) {
        patch.recycleUnchosen = recycle;
      }

      if (Object.keys(patch).length === 0) {
        const draft = engine.getState().buffetDraft;
        const config = draft?.config ?? defaultBuffetConfig();
        await replyOrEditInteraction(interaction, {
          content: [
            "**Buffet config** (current):",
            `• Recycle unchosen: **${config.recycleUnchosen ? "on" : "off"}**`,
            `• Mulligan steps: **${config.mulliganSteps.join(" → ")}**`,
            `• Enabled roles: **${config.enabledRoleIds.length}** (manage in admin panel)`,
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const events = engine.handle({
        kind: GameCommandKind.ConfigureBuffetDraft,
        gameId: game.id,
        config: patch,
      });
      await persistEvents(engine, events);
      await syncGameProjection(game.id, engine);

      await replyOrEditInteraction(interaction, {
        content: "Buffet config updated.",
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

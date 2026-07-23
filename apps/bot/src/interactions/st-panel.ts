import {
  ActionRowBuilder,
  MessageFlags,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { getGameById } from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import {
  canActAsStoryteller,
  getStorytellerThread,
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
  refreshAllNominationEverywhere,
  replyEngineError,
  resolveVotingChannel,
  syncGameProjection,
} from "../commands/command-context.js";
import { formatVoteVisibility } from "../day-thread.js";
import { postGameLog } from "../game-log-thread.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import {
  INTERACTION_PENDING_CONTENT,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";
import {
  parseStPanelButtonCustomId,
  parseStPanelUserSelectCustomId,
  stPanelUserSelectCustomId,
  upsertStControlPanel,
  type StPanelUserSelectAction,
} from "../st-control-panel.js";
import { upsertStVoteTracker } from "../st-vote-tracker.js";

async function loadPanelStorytellerContext(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
  gameId: string,
): Promise<
  | { ok: true; game: NonNullable<Awaited<ReturnType<typeof getGameById>>>; engine: Awaited<ReturnType<typeof loadEngine>>; guild: NonNullable<ButtonInteraction["guild"]> }
  | { ok: false; error: string }
> {
  if (!interaction.guildId || !interaction.guild) {
    return { ok: false, error: "This must be used in a server." };
  }

  const game = await getGameById(gameId);
  if (!game || game.guildId !== interaction.guildId) {
    return {
      ok: false,
      error:
        "No matching game for this panel (it may be from an older game). Run `/st setup-town` or refresh the panel from kib.",
    };
  }
  if (game.phase === "ended") {
    return { ok: false, error: "That game has ended." };
  }

  const engine = await loadEngine(game.id);
  if (!(await canActAsStoryteller(interaction, game, engine))) {
    return {
      ok: false,
      error: !game.stRoleId
        ? "Only storytellers can use the control panel. This game has no ST role linked — ask an ST to `/st do add-st` you, or re-run `/game setup` with `st:`."
        : "Only storytellers can use the control panel. Need this game’s ST Discord role, `/st do add-st`, or `ALLOWED_USER_IDS`.",
    };
  }

  return { ok: true, game, engine, guild: interaction.guild };
}

async function requirePanelStoryteller(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
  gameId: string,
) {
  const ctx = await loadPanelStorytellerContext(interaction, gameId);
  if (!ctx.ok) {
    await interaction.editReply({ content: ctx.error }).catch(() => undefined);
    return null;
  }
  return { game: ctx.game, engine: ctx.engine, guild: ctx.guild };
}

async function ensureDeferred(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction
      .reply({ content: INTERACTION_PENDING_CONTENT, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }
}

export async function handleStPanelButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseStPanelButtonCustomId(interaction.customId);
  if (!parsed) return false;

  const { action, gameId } = parsed;

  if (action === "execute" || action === "mark-dead" || action === "mark-alive") {
    await interaction
      .reply({
        content:
          action === "execute"
            ? "Select the player to execute:"
            : action === "mark-dead"
              ? "Select the player to mark dead:"
              : "Select the player to mark alive:",
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(stPanelUserSelectCustomId(action, gameId))
              .setPlaceholder("Choose a player")
              .setMinValues(1)
              .setMaxValues(1),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
    return true;
  }

  await ensureDeferred(interaction);
  const ctx = await requirePanelStoryteller(interaction, gameId);
  if (!ctx) return true;

  try {
    const { game, engine, guild } = ctx;

    if (action === "refresh") {
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
      await interaction.editReply({ content: "Control panel refreshed." });
      return true;
    }

    if (action === "votes") {
      const message = await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
      const thread = await getStorytellerThread(guild, game.channelId, {
        kibThreadId: game.kibThreadId,
        gameId: game.id,
      });
      await interaction.editReply({
        content: message
          ? `Vote tracker updated in ${thread ? `<#${thread.id}>` : "kib"}.`
          : "Could not post the vote tracker (kib missing or send failed — check the error channel).",
      });
      return true;
    }

    if (action === "vis-public" || action === "vis-secret") {
      const mode = action === "vis-public" ? "public" : "secret";
      const events = engine.handle({
        kind: GameCommandKind.SetVoteVisibility,
        gameId: game.id,
        visibility: mode,
      });
      await persistEvents(engine, events);
      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> set vote visibility to **${formatVoteVisibility(mode)}**.`,
      );
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
      await interaction.editReply({
        content: `Vote visibility set to **${formatVoteVisibility(mode)}**.`,
      });
      return true;
    }

    if (action === "resolve") {
      const next = engine.getNextOpenNomination();
      if (!next) {
        await interaction.editReply({ content: "No open nominations remain to resolve." });
        return true;
      }

      const events = engine.handle({
        kind: GameCommandKind.ResolveNomination,
        gameId: game.id,
      });
      await persistEvents(engine, events);

      const { cancelVoteDeadlineReminder } = await import("./lock-votes.js");
      await cancelVoteDeadlineReminder(next.id);

      const resolved = engine.getNominationById(next.id);
      const passed = resolved?.status === "resolved_pass";
      const tally = engine.formatNominationTally(next.id, { revealSecret: true });

      await refreshAllNominationEverywhere(guild, game, engine, { revealSecret: true });
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

      const channel = await resolveVotingChannel(guild, game, engine);
      const { formatNominationRef, resolveNominationMessageUrl } = await import("../day-thread.js");
      const nomUrl = await resolveNominationMessageUrl(channel, next.id);
      const nom = formatNominationRef(engine, next.id, nomUrl, { capitalize: true });

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> resolved ${nom}: **${passed ? "passed" : "failed"}**. ${tally}`,
      );

      await interaction.editReply({
        content:
          `${nom} ${passed ? "passed" : "failed"}. ${tally}` +
          (passed ? " Use **Execute…** on the control panel if needed." : ""),
      });
      return true;
    }

    if (action === "close-noms") {
      const { closeTownNominations } = await import("../town-day.js");
      const { dayNumber } = await closeTownNominations(guild, game, engine, interaction.user.id);
      await interaction.editReply({
        content: `Nominations closed for day **${dayNumber}**. Use **Start night** when ready.`,
      });
      return true;
    }

    if (action === "next-phase" || action === "next-day") {
      const { advanceTownPhase } = await import("../town-day.js");
      const { phase, phaseNumber } = await advanceTownPhase(
        guild,
        game,
        engine,
        interaction.user.id,
      );
      await interaction.editReply({
        content:
          phase === "day"
            ? `Day **${phaseNumber}** started — nominations are open again.`
            : `Night **${phaseNumber}** started — nominations are closed until the next day.`,
      });
      return true;
    }

    await interaction.editReply({ content: "Unknown panel action." });
  } catch (error) {
    try {
      await replyEngineError(interaction, error);
    } catch (replyError) {
      if (!isRecoverableInteractionResponseError(replyError)) throw replyError;
    }
  }

  return true;
}

export async function handleStPanelUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<boolean> {
  const parsed = parseStPanelUserSelectCustomId(interaction.customId);
  if (!parsed) return false;

  // Keep the select prompt as the interaction message so we can delete it when done.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const ctx = await loadPanelStorytellerContext(interaction, parsed.gameId);
  if (!ctx.ok) {
    await dismissPanelSelectPrompt(interaction, ctx.error);
    return true;
  }

  const selected = interaction.users.first();
  if (!selected) {
    await dismissPanelSelectPrompt(interaction, "No user selected.");
    return true;
  }

  try {
    const { game, engine, guild } = ctx;
    await runPanelUserAction(parsed.action, selected.id, game, guild, engine, interaction);
  } catch (error) {
    try {
      const message =
        error instanceof Error ? error.message : "Unexpected error running panel action.";
      await dismissPanelSelectPrompt(interaction, message);
    } catch (replyError) {
      if (!isRecoverableInteractionResponseError(replyError)) throw replyError;
    }
  }

  return true;
}

/** Remove the ephemeral player-select prompt, then confirm with a short follow-up. */
async function dismissPanelSelectPrompt(
  interaction: UserSelectMenuInteraction,
  content: string,
): Promise<void> {
  try {
    await interaction.deleteReply();
  } catch {
    await interaction.editReply({ content, components: [] }).catch(() => undefined);
    return;
  }
  await interaction
    .followUp({ content, flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}

async function runPanelUserAction(
  action: StPanelUserSelectAction,
  discordUserId: string,
  game: NonNullable<Awaited<ReturnType<typeof getGameById>>>,
  guild: NonNullable<ButtonInteraction["guild"]>,
  engine: Awaited<ReturnType<typeof loadEngine>>,
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  const target = engine.getPlayerByDiscordId(discordUserId);
  if (!target) {
    await dismissPanelSelectPrompt(interaction, "That user is not in this game.");
    return;
  }

  if (action === "execute") {
    const nomination = engine
      .getState()
      .day?.nominations.find(
        (candidate) =>
          candidate.nomineeId === target.id && candidate.status === "resolved_pass",
      );
    if (!nomination) {
      await dismissPanelSelectPrompt(
        interaction,
        "That player does not have a passed nomination to execute.",
      );
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
    await refreshNominationEverywhere(guild, game, engine, nomination.id, {
      revealSecret: true,
    });
    const channel = await resolveVotingChannel(guild, game, engine);
    await channel?.send(`**${target.displayName}** was executed.`).catch(() => undefined);
    await upsertPinnedGameStatus(guild, game.channelId, engine);
    await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
    await postGameLog(
      guild,
      game,
      `<@${interaction.user.id}> executed <@${target.discordUserId}>.`,
    );
    await dismissPanelSelectPrompt(interaction, `Executed **${target.displayName}**.`);
    return;
  }

  const markAlive = action === "mark-alive";
  const events = engine.handle({
    kind: GameCommandKind.SetPlayerAlive,
    gameId: game.id,
    playerId: target.id,
    alive: markAlive,
  });
  await persistEvents(engine, events);
  await upsertPinnedGameStatus(guild, game.channelId, engine);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
  await postGameLog(
    guild,
    game,
    `<@${interaction.user.id}> marked <@${target.discordUserId}> as **${markAlive ? "alive" : "dead"}**.`,
  );
  await dismissPanelSelectPrompt(
    interaction,
    `Marked **${target.displayName}** as **${markAlive ? "alive" : "dead"}**.`,
  );
}

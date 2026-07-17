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
  getStorytellerThread,
  loadEngine,
  persistEvents,
  refreshNominationEverywhere,
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

async function requirePanelStoryteller(
  interaction: ButtonInteraction | UserSelectMenuInteraction,
  gameId: string,
) {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.editReply({ content: "This must be used in a server." }).catch(() => undefined);
    return null;
  }

  const game = await getGameById(gameId);
  if (!game || game.guildId !== interaction.guildId) {
    await interaction
      .editReply({
        content:
          "No matching game for this panel (it may be from an older game). Run `/st do setup-town` or refresh the panel from kib.",
      })
      .catch(() => undefined);
    return null;
  }
  if (game.phase === "ended") {
    await interaction.editReply({ content: "That game has ended." }).catch(() => undefined);
    return null;
  }

  const engine = await loadEngine(game.id);
  if (!engine.isStoryteller(interaction.user.id)) {
    await interaction.editReply({ content: "Only storytellers can use the control panel." });
    return null;
  }

  return { game, engine, guild: interaction.guild };
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
          ? `Vote tracker updated in ${thread ? `<#${thread.id}>` : "your kib thread"}.`
          : "Could not post the vote tracker (kib thread missing or send failed — check the error channel).",
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

      const resolved = engine.getNominationById(next.id);
      const yesVotes = engine.getEffectiveYesVotes(next.id);
      const livingCount = engine.countLivingPlayers();
      const nominee = engine.getPlayerById(next.nomineeId);
      const passed = resolved?.status === "resolved_pass";
      const tally = engine.formatNominationTally(next.id, { revealSecret: true });

      await refreshNominationEverywhere(guild, game, engine, next.id, { revealSecret: true });
      await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

      const channel = await resolveVotingChannel(guild, game, engine);
      if (channel) {
        await channel
          .send(
            `Nomination #${next.order} for **${nominee?.displayName ?? "Unknown"}** ${passed ? "**passed**" : "**failed**"} (${yesVotes}/${livingCount} living, ${tally}).` +
              (passed ? " ST may use **Execute…** on the control panel." : ""),
          )
          .catch(() => undefined);
      }

      await interaction.editReply({
        content: `Nomination #${next.order} ${passed ? "passed" : "failed"}. ${tally}`,
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

  await ensureDeferred(interaction);
  const ctx = await requirePanelStoryteller(interaction, parsed.gameId);
  if (!ctx) return true;

  const selected = interaction.users.first();
  if (!selected) {
    await interaction.editReply({ content: "No user selected." });
    return true;
  }

  try {
    const { game, engine, guild } = ctx;
    await runPanelUserAction(parsed.action, selected.id, game, guild, engine, interaction);
  } catch (error) {
    try {
      await replyEngineError(interaction, error);
    } catch (replyError) {
      if (!isRecoverableInteractionResponseError(replyError)) throw replyError;
    }
  }

  return true;
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
    await interaction.editReply({ content: "That user is not in this game." });
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
      await interaction.editReply({
        content: "That player does not have a passed nomination to execute.",
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
    await refreshNominationEverywhere(guild, game, engine, nomination.id, {
      revealSecret: true,
    });
    const channel = await resolveVotingChannel(guild, game, engine);
    await channel?.send(`**${target.displayName}** was executed.`).catch(() => undefined);
    await upsertPinnedGameStatus(guild, game.channelId, engine);
    await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
    await interaction.editReply({ content: `Executed **${target.displayName}**.` });
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
  await interaction.editReply({
    content: `Marked **${target.displayName}** as **${markAlive ? "alive" : "dead"}**.`,
  });
}

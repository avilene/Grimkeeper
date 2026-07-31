import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
import { GameCommandKind } from "@grimkeeper/engine";

import { castVoteFromSlash } from "../interactions/day-vote.js";
import { postGameLogVoteCast } from "../game-log-thread.js";
import {
  loadEngine,
  noActiveGameHereMessage,
  persistEvents,
  postNominationEverywhere,
  refreshNominationEverywhere,
  replyEngineError,
  replyOrEditInteraction,
  requireActivePlayerGame,
  requireDayPlayAccess,
  requireTownVotingChannel,
  resolveActiveGameForInteraction,
  respondGamePlayerAutocomplete,
  syncGameProjection,
} from "./command-context.js";

async function respondNominatePlayerAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  await respondGamePlayerAutocomplete(interaction);
}

async function respondVoteNomineeAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  await respondGamePlayerAutocomplete(interaction, {
    openNomineesOnly: true,
  });
}

async function castPlayerVote(
  interaction: CommandInteraction,
  nomineeDiscordId: string,
  choice: string,
  reason: string | undefined,
  privateBallot: boolean,
): Promise<void> {
  if (!(await requireDayPlayAccess(interaction))) return;

  const context = await requireActivePlayerGame(interaction);
  if (!context) return;

  const { game, engine, player: voter } = context;
  if (!(await requireTownVotingChannel(interaction, game, engine))) return;

  const target = engine.getPlayerByDiscordId(nomineeDiscordId);
  if (!target) {
    await replyOrEditInteraction(interaction, {
      content: "Pick a nominee from the autocomplete list (open nominations only).",
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
      { privateBallot },
    );
    await persistEvents(updatedEngine, events);
    await syncGameProjection(game.id, updatedEngine);

    const isSecret = nomination.voteVisibility === "secret";
    const isSt = updatedEngine.isStoryteller(interaction.user.id);

    if (interaction.guild) {
      await refreshNominationEverywhere(
        interaction.guild,
        game,
        updatedEngine,
        nomination.id,
        { revealSecret: false },
      );
      const nominee = updatedEngine.getPlayerById(nomination.nomineeId);
      await postGameLogVoteCast(interaction.guild, game, {
        voterDiscordId: interaction.user.id,
        nomineeLabel: nominee?.displayName ?? "nominee",
        choice,
        ballot: privateBallot ? "private" : "public",
      });
    }

    if (privateBallot) {
      await replyOrEditInteraction(interaction, {
        content:
          isSecret && !isSt
            ? "Private vote recorded. The storyteller sees it on the kib vote tracker."
            : `Private vote recorded (${choice}). The storyteller sees it on the kib vote tracker.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isSecret && !isSt) {
      await replyOrEditInteraction(interaction, {
        content: "Vote recorded privately.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyOrEditInteraction(interaction, {
      content: `Vote recorded (${choice}).`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }
}

/** Top-level player day commands — `/nominate`, `/accusation`, `/defend`, `/vote`, `/privatevote`, `/roster`. */
@Discord()
export class PlayerDayCommandsMinimal {
  @Slash({ name: "nominate", description: "Nominate a player (Town Voting)" })
  async nominate(
    @SlashOption({
      name: "player",
      description: "Player to nominate (type to search the game roster)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondNominatePlayerAutocomplete,
    })
    playerDiscordId: string,
    @SlashOption({
      name: "accusation",
      description: "Accusation text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    accusation: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player: nominator } = context;
    if (!(await requireTownVotingChannel(interaction, game, engine))) return;

    const target = engine.getPlayerByDiscordId(playerDiscordId);
    if (!target) {
      await replyOrEditInteraction(interaction, {
        content: "Pick a player from the autocomplete list (in-game roster only).",
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
            voteThreadId
              ? `Posted in <#${voteThreadId}>${posted.voteThread ? " (players pinged)." : "."}`
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

  @Slash({ name: "accusation", description: "Update your accusation on an open nomination you made" })
  async accusation(
    @SlashOption({
      name: "text",
      description: "Updated accusation text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player } = context;
    if (!(await requireTownVotingChannel(interaction, game, engine))) return;

    const nomination = engine
      .getState()
      .day?.nominations.find(
        (candidate) => candidate.nominatorId === player.id && candidate.status === "open",
      );
    if (!nomination) {
      await replyOrEditInteraction(interaction, {
        content: "You do not have an open nomination whose accusation you can update.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const events = engine.handle({
        kind: GameCommandKind.UpdateAccusation,
        gameId: game.id,
        nominationId: nomination.id,
        playerId: player.id,
        accusation: text,
      });
      await persistEvents(engine, events);

      if (interaction.guild) {
        await refreshNominationEverywhere(interaction.guild, game, engine, nomination.id);
      }

      await replyOrEditInteraction(interaction, {
        content: "Accusation updated.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }

  @Slash({ name: "defend", description: "Add your defense to an open nomination against you" })
  async defend(
    @SlashOption({
      name: "text",
      description: "Defense text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;

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
        nominationId: nomination.id,
        playerId: player.id,
        defense: text,
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

  @Slash({ name: "vote", description: "Cast a public vote on an open nomination" })
  async vote(
    @SlashOption({
      name: "nominee",
      description: "Open nominee to vote on (type to search)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondVoteNomineeAutocomplete,
    })
    nomineeDiscordId: string,
    @SlashChoice({ name: "Yes", value: "yes" })
    @SlashChoice({ name: "No", value: "no" })
    @SlashChoice({ name: "Conditional", value: "conditional" })
    @SlashOption({
      name: "choice",
      description: "Your vote",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    choice: string,
    @SlashOption({
      name: "reason",
      description: "Required for conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await castPlayerVote(interaction, nomineeDiscordId, choice, reason, true);
  }

  @Slash({ name: "roster", description: "Show seat order and alive/dead status" })
  async roster(interaction: CommandInteraction): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;

    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      await replyOrEditInteraction(interaction, {
        content: await noActiveGameHereMessage(interaction.guildId),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const engine = await loadEngine(game.id);
    const state = engine.getState();
    if (!state.townMode) {
      await replyOrEditInteraction(interaction, {
        content: "Town is not set up yet. Storyteller must run `/st setup-town`.",
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

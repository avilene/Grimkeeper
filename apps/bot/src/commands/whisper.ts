import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

import { createWhisperThread, defaultWhisperName } from "../whisper-thread.js";
import { postGameLog } from "../game-log-thread.js";
import {
  replyOrEditInteraction,
  requireActivePlayerGame,
  requireCommandAccess,
  respondGamePlayerAutocomplete,
} from "./command-context.js";

async function respondWhisperTargetAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  await respondGamePlayerAutocomplete(interaction, {
    excludeUserId: interaction.user.id,
  });
}

@Discord()
export class WhisperCommands {
  @Slash({
    name: "whisper",
    description: "Open a private whisper thread with another player",
  })
  async whisper(
    @SlashOption({
      name: "player",
      description: "Player to whisper with (type to search the game roster)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondWhisperTargetAutocomplete,
    })
    playerDiscordId: string,
    @SlashOption({
      name: "name",
      description: "Thread name (default: you & them; NW appended if neighbor)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    name: string | undefined,
    @SlashOption({
      name: "neighbor",
      description: "Append NW to the thread name (neighbor whisper)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    neighbor: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    const context = await requireActivePlayerGame(interaction);
    if (!context) return;

    const { game, engine, player: creator } = context;
    const guild = interaction.guild;
    if (!guild) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = engine.getState();
    if (state.phase === "lobby" || state.phase === "ended" || !state.townMode) {
      await replyOrEditInteraction(interaction, {
        content: "Whispers open after `/st do setup-town`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (playerDiscordId === interaction.user.id) {
      await replyOrEditInteraction(interaction, {
        content: "You cannot open a whisper with yourself.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = engine.getPlayerByDiscordId(playerDiscordId);
    if (!target) {
      await replyOrEditInteraction(interaction, {
        content: "Pick a player from the autocomplete list (in-game roster only).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isNeighbor = neighbor === true;
    const threadName = name?.trim()
      ? (isNeighbor && !/\bNW\b/i.test(name) ? `${name.trim()} NW` : name.trim()).slice(0, 100)
      : defaultWhisperName(creator.displayName, target.displayName, isNeighbor);

    const thread = await createWhisperThread(guild, game, engine, {
      creatorDiscordId: creator.discordUserId,
      targetDiscordId: target.discordUserId,
      creatorDisplayName: creator.displayName,
      targetDisplayName: target.displayName,
      name: threadName,
      neighbor: isNeighbor,
    });

    if (!thread) {
      await replyOrEditInteraction(interaction, {
        content: "Could not create the whisper thread. Check that the town channel allows private threads.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await postGameLog(
      guild,
      game,
      `<@${creator.discordUserId}> opened whisper with <@${target.discordUserId}>: <#${thread.id}>` +
        (isNeighbor ? " (NW)" : ""),
    ).catch(() => undefined);

    await replyOrEditInteraction(interaction, {
      content: `Whisper opened: <#${thread.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

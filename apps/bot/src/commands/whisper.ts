import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  type Guild,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import type { GameEngine, PlayerState } from "@grimkeeper/engine";

import {
  formatWhisperDeclaration,
  getSeatedNeighborPlayers,
  openOrReuseWhisperThread,
} from "../whisper-thread.js";
import { postGameLog } from "../game-log-thread.js";
import { getTownSurfaceThread } from "../town-surfaces.js";
import { parseUserMentionsFromString } from "../town-setup.js";
import {
  replyOrEditInteraction,
  requireActivePlayerGame,
} from "./command-context.js";

type ActiveWhisperContext = {
  game: {
    id: string;
    channelId: string;
    stRoleId?: string | null;
    kibThreadId?: string | null;
    logThreadId?: string | null;
    whisperDeclThreadId?: string | null;
    claimsThreadId?: string | null;
    rulesThreadId?: string | null;
  };
  engine: GameEngine;
  player: PlayerState;
  guild: Guild;
};

async function requireWhisperContext(
  interaction: CommandInteraction,
): Promise<ActiveWhisperContext | null> {
  const context = await requireActivePlayerGame(interaction);
  if (!context) return null;

  const guild = interaction.guild;
  if (!guild) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const state = context.engine.getState();
  if (state.phase === "lobby" || state.phase === "ended" || !state.townMode) {
    await replyOrEditInteraction(interaction, {
      content: "Whispers open after `/st setup-town`.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return { ...context, guild };
}

async function postPublicDeclarations(
  interaction: CommandInteraction,
  guild: Guild,
  game: ActiveWhisperContext["game"],
  declarations: string[],
): Promise<void> {
  const whisperDecl = await getTownSurfaceThread(guild, game, "whisper-decl");
  const target =
    whisperDecl && "send" in whisperDecl
      ? whisperDecl
      : interaction.channel && "send" in interaction.channel
        ? interaction.channel
        : null;

  if (target) {
    for (const declaration of declarations) {
      await target
        .send({ content: declaration, allowedMentions: { parse: [] } })
        .catch(() => undefined);
    }
  }

  const fallback = declarations[0] ?? "Whisper ready.";
  if (interaction.replied || interaction.deferred) {
    await interaction.deleteReply().catch(async () => {
      await replyOrEditInteraction(interaction, {
        content: fallback,
        flags: MessageFlags.Ephemeral,
      });
    });
    return;
  }

  await interaction.reply({ content: fallback });
}

@Discord()
@SlashGroup({ name: "whisper", description: "Open private whisper threads with other players" })
@SlashGroup("whisper")
export class WhisperCommands {
  @Slash({
    name: "neighbor",
    description: "Open (or resume) NW whispers with both seated neighbors",
  })
  async neighbor(interaction: CommandInteraction): Promise<void> {
    const context = await requireWhisperContext(interaction);
    if (!context) return;

    const { game, engine, player: creator, guild } = context;
    const neighbors = getSeatedNeighborPlayers(creator, engine.getState().players);

    if (neighbors.length === 0) {
      await replyOrEditInteraction(interaction, {
        content: "You have no seated neighbors yet (need a seat on the roster).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const declarations: string[] = [];
    const failedNames: string[] = [];

    for (const neighbor of neighbors) {
      const participants = [
        { discordUserId: creator.discordUserId, displayName: creator.displayName },
        { discordUserId: neighbor.discordUserId, displayName: neighbor.displayName },
      ];
      const opened = await openOrReuseWhisperThread(guild, game, engine, {
        creatorDiscordId: creator.discordUserId,
        participants,
        neighbor: true,
      });

      if (!opened) {
        failedNames.push(neighbor.displayName);
        continue;
      }

      declarations.push(formatWhisperDeclaration([creator.displayName, neighbor.displayName]));
      await postGameLog(
        guild,
        game,
        `<@${creator.discordUserId}> ${opened.reused ? "resumed" : "opened"} NW whisper with <@${neighbor.discordUserId}>: <#${opened.thread.id}>`,
      ).catch(() => undefined);
    }

    if (declarations.length === 0) {
      await replyOrEditInteraction(interaction, {
        content: `Could not open neighbor whispers${
          failedNames.length > 0 ? ` (${failedNames.join(", ")})` : ""
        }.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await postPublicDeclarations(interaction, guild, game, declarations);
  }

  @Slash({
    name: "with",
    description: "Open (or resume) a whisper with one or more players",
  })
  async withPlayers(
    @SlashOption({
      name: "players",
      description: "@mentions of players to whisper with",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    playersRaw: string,
    @SlashOption({
      name: "name",
      description: "Thread name (default: you & them, or Group (names) for 3+)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    name: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const context = await requireWhisperContext(interaction);
    if (!context) return;

    const { game, engine, player: creator, guild } = context;
    const mentionIds = parseUserMentionsFromString(playersRaw).filter(
      (id) => id !== creator.discordUserId,
    );

    if (mentionIds.length === 0) {
      await replyOrEditInteraction(interaction, {
        content: "Mention at least one other player in `players:`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const others: PlayerState[] = [];
    for (const discordId of mentionIds) {
      const target = engine.getPlayerByDiscordId(discordId);
      if (!target) {
        await replyOrEditInteraction(interaction, {
          content: `Everyone in \`players:\` must be on the game roster (<@${discordId}> is not).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      others.push(target);
    }

    const participants = [
      { discordUserId: creator.discordUserId, displayName: creator.displayName },
      ...others.map((p) => ({
        discordUserId: p.discordUserId,
        displayName: p.displayName,
      })),
    ];

    const opened = await openOrReuseWhisperThread(guild, game, engine, {
      creatorDiscordId: creator.discordUserId,
      participants,
      name,
      neighbor: false,
    });

    if (!opened) {
      await replyOrEditInteraction(interaction, {
        content:
          "Could not create the whisper thread. Check that the town channel allows private threads.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const displayNames = participants.map((p) => p.displayName);
    await postGameLog(
      guild,
      game,
      `<@${creator.discordUserId}> ${opened.reused ? "resumed" : "opened"} whisper (${displayNames.join(", ")}): <#${opened.thread.id}>`,
    ).catch(() => undefined);

    await postPublicDeclarations(interaction, guild, game, [
      formatWhisperDeclaration(displayNames),
    ]);
  }
}

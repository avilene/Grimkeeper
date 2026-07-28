import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  type User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

import {
  addBackpackerEverywhere,
  addBackpackerForHost,
  removeBackpackerEverywhere,
  removeBackpackerForHost,
} from "../backpacker.js";
import { postGameLog } from "../game-log-thread.js";
import {
  canActAsStoryteller,
  loadEngine,
  replyEngineError,
  replyOrEditInteraction,
  requireActivePlayerGame,
  requireDayPlayAccess,
  resolveActiveGameForInteraction,
  setInteractionProgress,
} from "./command-context.js";

@Discord()
@SlashGroup({
  name: "backpack",
  description: "Invite a follower into your private ST thread and whispers",
})
@SlashGroup("backpack")
export class BackpackCommands {
  @Slash({
    name: "add",
    description: "Add a backpacker to your ST thread + whispers (or everywhere if ST)",
  })
  async add(
    @SlashOption({
      name: "user",
      description: "Person to backpack (must not have this game’s ST or kib role)",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "everywhere",
      description: "ST only: add to every player ST + whisper thread",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    everywhere: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;
    await this.runBackpack(interaction, user, Boolean(everywhere), "add");
  }

  @Slash({
    name: "remove",
    description: "Remove a backpacker from your ST thread + whispers (or everywhere if ST)",
  })
  async remove(
    @SlashOption({
      name: "user",
      description: "Backpacker to remove",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "everywhere",
      description: "ST only: remove from every player ST + whisper thread",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    everywhere: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireDayPlayAccess(interaction))) return;
    await this.runBackpack(interaction, user, Boolean(everywhere), "remove");
  }

  private async runBackpack(
    interaction: CommandInteraction,
    user: User,
    everywhere: boolean,
    mode: "add" | "remove",
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await replyOrEditInteraction(interaction, {
        content: "This command must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      if (everywhere) {
        const game = await resolveActiveGameForInteraction(interaction);
        if (!game) {
          await replyOrEditInteraction(interaction, {
            content: "No active game in this channel.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const engine = await loadEngine(game.id);
        if (!(await canActAsStoryteller(interaction, game, engine))) {
          await replyOrEditInteraction(interaction, {
            content: "Only storytellers can use `everywhere:True`.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await setInteractionProgress(
          interaction,
          mode === "add"
            ? "Adding backpacker to all player ST and whisper threads…"
            : "Removing backpacker from all player ST and whisper threads…",
        );

        const result =
          mode === "add"
            ? await addBackpackerEverywhere(guild, game, engine, user)
            : await removeBackpackerEverywhere(guild, game, engine, user);

        if (!result.ok) {
          await replyOrEditInteraction(interaction, {
            content: result.message,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await postGameLog(
          guild,
          game,
          `<@${interaction.user.id}> ${mode === "add" ? "added" : "removed"} backpacker <@${user.id}> ` +
            `(everywhere: **${result.stThreads}** ST / **${result.whisperThreads}** whisper).`,
        ).catch(() => undefined);

        await replyOrEditInteraction(interaction, {
          content: result.message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const context = await requireActivePlayerGame(interaction);
      if (!context) return;

      const { game, player: host } = context;
      await setInteractionProgress(
        interaction,
        mode === "add"
          ? "Adding backpacker to your ST thread and whispers…"
          : "Removing backpacker from your ST thread and whispers…",
      );

      const result =
        mode === "add"
          ? await addBackpackerForHost(guild, game, host, user)
          : await removeBackpackerForHost(guild, game, host, user);

      if (!result.ok) {
        await replyOrEditInteraction(interaction, {
          content: result.message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await postGameLog(
        guild,
        game,
        `<@${interaction.user.id}> ${mode === "add" ? "added" : "removed"} backpacker <@${user.id}> ` +
          `on seat **${host.displayName}**.`,
      ).catch(() => undefined);

      await replyOrEditInteraction(interaction, {
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyEngineError(interaction, error);
    }
  }
}

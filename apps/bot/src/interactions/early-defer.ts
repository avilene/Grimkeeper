import { type ChatInputCommandInteraction, type Interaction, MessageFlags } from "discord.js";

import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isBenignInteractionAckError,
} from "./interaction-response.js";
import { log } from "../logger.js";

const FAST_SUBCOMMANDS = new Set(["help"]);
const FAST_SUBCOMMAND_GROUPS = new Set(["guide"]);

/** Top-level player day commands. */
const PLAYER_DAY_COMMANDS = new Set([
  "nominate",
  "defend",
  "vote",
  "privatevote",
  "roster",
  "whisper",
]);

const INTERACTION_DEFER_BUDGET_MS = 2_800;

export function shouldDeferSlashCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  if (subcommandGroup !== null && FAST_SUBCOMMAND_GROUPS.has(subcommandGroup)) {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== null && FAST_SUBCOMMANDS.has(subcommand)) return false;

  if (PLAYER_DAY_COMMANDS.has(interaction.commandName)) {
    return true;
  }

  if (interaction.commandName === "game") {
    return true;
  }

  if (interaction.commandName !== "st") return false;

  return true;
}

/** @deprecated Use shouldDeferSlashCommand */
export function shouldDeferStSlashCommand(interaction: Interaction): boolean {
  return shouldDeferSlashCommand(interaction);
}

/** @deprecated Use startEarlyDefer */
export function shouldDeferStReminderCommand(interaction: Interaction): boolean {
  return shouldDeferSlashCommand(interaction);
}

/** Acknowledge immediately with custom pending text (Discord's deferReply text is not customizable). */
export function startEarlyDefer(interaction: Interaction): Promise<void> {
  if (!shouldDeferSlashCommand(interaction)) return Promise.resolve();

  const command = interaction as ChatInputCommandInteraction;
  if (command.deferred || command.replied) return Promise.resolve();

  const ageMs = Date.now() - command.createdTimestamp;
  if (ageMs > INTERACTION_DEFER_BUDGET_MS) {
    const context = {
      ageMs,
      command: command.commandName,
      subcommand: command.options.getSubcommand(false) ?? undefined,
      guildId: command.guildId,
      channelId: command.channelId,
      userId: command.user.id,
    };
    log("warn", "interaction.defer.late", context);
    void reportError(
      "interaction.defer.late",
      new Error(`Interaction ack started ${ageMs}ms after create`),
      context,
    );
  }

  return command
    .reply({ content: INTERACTION_PENDING_CONTENT, flags: MessageFlags.Ephemeral })
    .then(
      () => undefined,
      (error: unknown) => {
        if (isBenignInteractionAckError(error)) {
          log("warn", "interaction.defer.skipped", {
            command: command.commandName,
            subcommand: command.options.getSubcommand(false) ?? undefined,
            guildId: command.guildId,
            channelId: command.channelId,
            userId: command.user.id,
            ageMs,
            code: error && typeof error === "object" && "code" in error ? error.code : undefined,
          });
          return undefined;
        }
        const context = {
          command: command.commandName,
          subcommand: command.options.getSubcommand(false) ?? undefined,
          guildId: command.guildId,
          channelId: command.channelId,
          userId: command.user.id,
          ageMs,
        };
        log("warn", "interaction.defer.failed", {
          ...context,
          error: error instanceof Error ? error.message : String(error),
        });
        void reportError("interaction.defer.failed", error, context);
      },
    );
}

export async function deferStReminderCommand(interaction: Interaction): Promise<void> {
  await startEarlyDefer(interaction);
}

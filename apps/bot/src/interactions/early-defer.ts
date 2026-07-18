import { type ChatInputCommandInteraction, Interaction, MessageFlags } from "discord.js";

import { isMinimalMode } from "../bot-mode.js";
import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isBenignInteractionAckError,
} from "./interaction-response.js";
import { log } from "../logger.js";

const ST_REMINDER_SUBCOMMANDS = new Set([
  "remind",
  "set-reminders",
  "reminders",
  "clear-reminders",
  "delete-reminder",
  "edit-reminder",
]);

const FAST_SUBCOMMANDS = new Set(["help", "commands"]);

/** Top-level player day commands (minimal mode). */
const PLAYER_DAY_COMMANDS = new Set(["nominate", "defend", "vote", "roster"]);

const INTERACTION_DEFER_BUDGET_MS = 2_800;

export function shouldDeferSlashCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;

  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== null && FAST_SUBCOMMANDS.has(subcommand)) return false;

  if (PLAYER_DAY_COMMANDS.has(interaction.commandName)) {
    return isMinimalMode();
  }

  if (interaction.commandName === "game") {
    return isMinimalMode();
  }

  if (interaction.commandName !== "st") return false;

  if (isMinimalMode()) return true;

  return subcommand !== null && ST_REMINDER_SUBCOMMANDS.has(subcommand);
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
    // Still attempt ack — Discord may accept within the window — but page only when truly late.
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
        // 10062/40060: expired token or another replica already acked — not actionable pages.
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

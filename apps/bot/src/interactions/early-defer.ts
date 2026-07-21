import { type ChatInputCommandInteraction, type Interaction, MessageFlags } from "discord.js";

import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isBenignInteractionAckError,
} from "./interaction-response.js";
import { log } from "../logger.js";

const FAST_SUBCOMMANDS = new Set(["help", "guide"]);
/** Nested `/st guide setup|day|night` — ack with public defer, not ephemeral "Working…". */
const FAST_SUBCOMMAND_GROUPS = new Set(["guide"]);
const GUIDE_NESTED_SUBCOMMANDS = new Set(["setup", "day", "night"]);

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

/**
 * Help + phase guides: handler builds embeds then editReply.
 * Must not use the ephemeral "Working…" ack (that left guides spinning).
 */
export function isHelpOrGuideCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  if (subcommandGroup !== null && FAST_SUBCOMMAND_GROUPS.has(subcommandGroup)) {
    return true;
  }

  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== null && FAST_SUBCOMMANDS.has(subcommand)) return true;

  // Safety: nested guide without group metadata.
  if (
    interaction.commandName === "st" &&
    subcommand !== null &&
    GUIDE_NESTED_SUBCOMMANDS.has(subcommand)
  ) {
    return true;
  }

  return false;
}

/** Ephemeral "Working…" early ack for slower slash handlers (not help/guide). */
export function shouldDeferSlashCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  if (isHelpOrGuideCommand(interaction)) return false;

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

function interactionAckContext(command: ChatInputCommandInteraction, ageMs: number) {
  return {
    ageMs,
    command: command.commandName,
    subcommandGroup: command.options.getSubcommandGroup(false) ?? undefined,
    subcommand: command.options.getSubcommand(false) ?? undefined,
    guildId: command.guildId,
    channelId: command.channelId,
    userId: command.user.id,
  };
}

function warnIfAckLate(command: ChatInputCommandInteraction, ageMs: number): void {
  if (ageMs <= INTERACTION_DEFER_BUDGET_MS) return;
  const context = interactionAckContext(command, ageMs);
  log("warn", "interaction.defer.late", context);
  void reportError(
    "interaction.defer.late",
    new Error(`Interaction ack started ${ageMs}ms after create`),
    context,
  );
}

function handleAckFailure(
  command: ChatInputCommandInteraction,
  ageMs: number,
  error: unknown,
): void {
  const context = interactionAckContext(command, ageMs);
  if (isBenignInteractionAckError(error)) {
    log("warn", "interaction.defer.skipped", {
      ...context,
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    });
    return;
  }
  log("warn", "interaction.defer.failed", {
    ...context,
    error: error instanceof Error ? error.message : String(error),
  });
  void reportError("interaction.defer.failed", error, context);
}

/**
 * Acknowledge immediately on interactionCreate.
 * - Help/guide: public deferReply (handler editReply with embeds)
 * - Other deferred commands: ephemeral "Working…"
 */
export function startEarlyDefer(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return Promise.resolve();

  const command = interaction as ChatInputCommandInteraction;
  if (command.deferred || command.replied) return Promise.resolve();

  const ageMs = Date.now() - command.createdTimestamp;
  const helpOrGuide = isHelpOrGuideCommand(command);
  if (!helpOrGuide && !shouldDeferSlashCommand(command)) {
    return Promise.resolve();
  }

  warnIfAckLate(command, ageMs);

  const ack = helpOrGuide
    ? command.deferReply()
    : command.reply({ content: INTERACTION_PENDING_CONTENT, flags: MessageFlags.Ephemeral });

  return ack.then(
    () => undefined,
    (error: unknown) => {
      handleAckFailure(command, ageMs, error);
    },
  );
}

export async function deferStReminderCommand(interaction: Interaction): Promise<void> {
  await startEarlyDefer(interaction);
}

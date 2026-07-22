import { type ChatInputCommandInteraction, type Interaction, MessageFlags } from "discord.js";

import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isBenignInteractionAckError,
  isUnknownInteractionError,
} from "./interaction-response.js";
import { log } from "../logger.js";

const FAST_SUBCOMMANDS = new Set(["help", "guide"]);
/** Nested `/st guide setup|day|night` — ack with public defer, not ephemeral "Working…". */
const FAST_SUBCOMMAND_GROUPS = new Set(["guide"]);
const GUIDE_NESTED_SUBCOMMANDS = new Set(["setup", "day", "night"]);
/** `/st queue join|edit` open a modal — must not early-ack. */
const QUEUE_MODAL_SUBCOMMANDS = new Set(["join", "edit"]);

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

/** Slash commands that open a modal as the first response. */
export function isModalOpeningCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  return (
    interaction.commandName === "st" &&
    subcommandGroup === "queue" &&
    subcommand !== null &&
    QUEUE_MODAL_SUBCOMMANDS.has(subcommand)
  );
}

/** Ephemeral "Working…" early ack for slower slash handlers (not help/guide/modals). */
export function shouldDeferSlashCommand(interaction: Interaction): boolean {
  if (!interaction.isChatInputCommand()) return false;
  if (isHelpOrGuideCommand(interaction)) return false;
  if (isModalOpeningCommand(interaction)) return false;

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
  const code =
    error && typeof error === "object" && "code" in error ? error.code : undefined;
  const context = { ...interactionAckContext(command, ageMs), code };

  if (isUnknownInteractionError(error)) {
    // 10062 — Discord already expired the token (slow bot, duplicate replica, etc.).
    log("warn", "interaction.ack.unknown", context);
    void reportError("interaction.ack.unknown", error, context);
    return;
  }

  if (isBenignInteractionAckError(error)) {
    log("warn", "interaction.ack.skipped", context);
    void reportError("interaction.ack.skipped", error, context);
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

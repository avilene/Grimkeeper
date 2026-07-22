import { describe, expect, it } from "vitest";

import {
  isHelpOrGuideCommand,
  shouldDeferSlashCommand,
  shouldDeferStReminderCommand,
} from "./early-defer.js";

function chatCommand(
  commandName: string,
  subcommand: string | null,
  subcommandGroup: string | null = null,
) {
  return {
    isChatInputCommand: () => true,
    commandName,
    options: {
      getSubcommandGroup: (required?: boolean) => {
        if (subcommandGroup === null && required === false) return null;
        if (subcommandGroup === null) throw new Error("missing subcommand group");
        return subcommandGroup;
      },
      getSubcommand: (required?: boolean) => {
        if (subcommand === null && required === false) return null;
        if (subcommand === null) throw new Error("missing subcommand");
        return subcommand;
      },
    },
  };
}

describe("isHelpOrGuideCommand", () => {
  it("matches help and guide checklists", () => {
    expect(isHelpOrGuideCommand(chatCommand("st", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("game", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("dev", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("st", "setup", "guide") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("st", "day", "guide") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("st", "night", "guide") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("st", "setup") as never)).toBe(true);
  });

  it("does not match other st commands", () => {
    expect(isHelpOrGuideCommand(chatCommand("st", "panel") as never)).toBe(false);
    expect(isHelpOrGuideCommand(chatCommand("st", "remind") as never)).toBe(false);
    expect(isHelpOrGuideCommand(chatCommand("nominate", null) as never)).toBe(false);
  });
});

describe("shouldDeferSlashCommand", () => {
  it("defers reminder and other /st commands except help", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "remind") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "set-reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "execute") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "help") as never)).toBe(false);
  });

  it("defers /game commands except help", () => {
    expect(shouldDeferSlashCommand(chatCommand("game", "setup") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("game", "help") as never)).toBe(false);
  });

  it("does not ephemeral-defer /st guide checklists", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "setup", "guide") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "day", "guide") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "night", "guide") as never)).toBe(false);
    // Nested guide without group metadata still must not ephemeral-ack.
    expect(shouldDeferSlashCommand(chatCommand("st", "setup") as never)).toBe(false);
  });

  it("defers top-level day commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("nominate", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("defend", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("vote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("privatevote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("roster", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("whisper", null) as never)).toBe(true);
  });

  it("does not defer /role (public character lookup)", () => {
    expect(shouldDeferSlashCommand(chatCommand("role", null) as never)).toBe(false);
  });

  it("does not ephemeral-defer modal-opening /st queue commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "join", "queue") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "edit", "queue") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "show", "queue") as never)).toBe(true);
  });
});

describe("shouldDeferStReminderCommand", () => {
  it("matches shouldDeferSlashCommand", () => {
    expect(shouldDeferStReminderCommand(chatCommand("st", "remind") as never)).toBe(true);
  });
});

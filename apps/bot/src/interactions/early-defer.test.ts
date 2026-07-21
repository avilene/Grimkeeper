import { describe, expect, it } from "vitest";

import { shouldDeferSlashCommand, shouldDeferStReminderCommand } from "./early-defer.js";

function chatCommand(commandName: string, subcommand: string | null) {
  return {
    isChatInputCommand: () => true,
    commandName,
    options: {
      getSubcommand: (required?: boolean) => {
        if (subcommand === null && required === false) return null;
        if (subcommand === null) throw new Error("missing subcommand");
        return subcommand;
      },
    },
  };
}

describe("shouldDeferSlashCommand", () => {
  it("defers reminder and other /st commands except help", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "remind") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "set-reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "execute") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "help") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "commands") as never)).toBe(false);
  });

  it("defers /game commands except help/commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("game", "setup") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("game", "help") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("game", "commands") as never)).toBe(false);
  });

  it("defers top-level day commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("nominate", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("defend", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("vote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("privatevote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("roster", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("whisper", null) as never)).toBe(true);
  });
});

describe("shouldDeferStReminderCommand", () => {
  it("matches shouldDeferSlashCommand", () => {
    expect(shouldDeferStReminderCommand(chatCommand("st", "remind") as never)).toBe(true);
  });
});

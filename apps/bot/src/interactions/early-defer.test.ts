import { describe, expect, it, vi } from "vitest";

vi.mock("../bot-mode.js", () => ({
  isMinimalMode: vi.fn(() => false),
}));

import { isMinimalMode } from "../bot-mode.js";
import { shouldDeferStSlashCommand, shouldDeferStReminderCommand } from "./early-defer.js";

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

describe("shouldDeferStSlashCommand", () => {
  it("defers reminder subcommands in full mode", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferStSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferStSlashCommand(chatCommand("st", "remind") as never)).toBe(true);
    expect(shouldDeferStSlashCommand(chatCommand("st", "set-reminders") as never)).toBe(true);
  });

  it("skips non-reminder /st subcommands in full mode", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferStSlashCommand(chatCommand("st", "execute") as never)).toBe(false);
  });

  it("defers all /st commands in minimal mode except help", () => {
    vi.mocked(isMinimalMode).mockReturnValue(true);
    expect(shouldDeferStSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferStSlashCommand(chatCommand("st", "execute") as never)).toBe(true);
    expect(shouldDeferStSlashCommand(chatCommand("st", "help") as never)).toBe(false);
    expect(shouldDeferStSlashCommand(chatCommand("st", "commands") as never)).toBe(false);
  });

  it("skips non-/st commands", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferStSlashCommand(chatCommand("game", "create") as never)).toBe(false);
  });
});

describe("shouldDeferStReminderCommand", () => {
  it("matches shouldDeferStSlashCommand", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferStReminderCommand(chatCommand("st", "remind") as never)).toBe(true);
  });
});

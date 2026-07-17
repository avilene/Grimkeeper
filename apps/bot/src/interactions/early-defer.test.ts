import { describe, expect, it, vi } from "vitest";

vi.mock("../bot-mode.js", () => ({
  isMinimalMode: vi.fn(() => false),
}));

import { isMinimalMode } from "../bot-mode.js";
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
  it("defers reminder subcommands in full mode", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "remind") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "set-reminders") as never)).toBe(true);
  });

  it("skips non-reminder /st subcommands in full mode", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "execute") as never)).toBe(false);
  });

  it("defers all /st commands in minimal mode except help", () => {
    vi.mocked(isMinimalMode).mockReturnValue(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "reminders") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "execute") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "help") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "commands") as never)).toBe(false);
  });

  it("defers /game commands in minimal mode except help", () => {
    vi.mocked(isMinimalMode).mockReturnValue(true);
    expect(shouldDeferSlashCommand(chatCommand("game", "do") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("game", "help") as never)).toBe(false);
  });

  it("skips /game commands in full mode", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferSlashCommand(chatCommand("game", "create") as never)).toBe(false);
  });
});

describe("shouldDeferStReminderCommand", () => {
  it("matches shouldDeferSlashCommand", () => {
    vi.mocked(isMinimalMode).mockReturnValue(false);
    expect(shouldDeferStReminderCommand(chatCommand("st", "remind") as never)).toBe(true);
  });
});

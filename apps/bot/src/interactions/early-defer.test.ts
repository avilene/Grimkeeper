import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  log: vi.fn(),
}));

import { reportError } from "../error-reporter.js";
import {
  isHelpOrGuideCommand,
  shouldDeferSlashCommand,
  shouldDeferStReminderCommand,
  startEarlyDefer,
} from "./early-defer.js";
import {
  shouldReportUnknownInteractionAck,
  UNKNOWN_INTERACTION_REPORT_MIN_AGE_MS,
} from "./interaction-response.js";

function chatCommand(
  commandName: string,
  subcommand: string | null,
  subcommandGroup: string | null = null,
  extras: Record<string, unknown> = {},
) {
  return {
    isChatInputCommand: () => true,
    commandName,
    deferred: false,
    replied: false,
    createdTimestamp: Date.now(),
    guildId: "g1",
    channelId: "c1",
    user: { id: "u1" },
    deferReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
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
    ...extras,
  };
}

describe("isHelpOrGuideCommand", () => {
  it("matches help and guide checklists", () => {
    expect(isHelpOrGuideCommand(chatCommand("st", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("game", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("player", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("dev", "help") as never)).toBe(true);
    expect(isHelpOrGuideCommand(chatCommand("st", "guide") as never)).toBe(true);
  });

  it("does not match other st commands", () => {
    expect(isHelpOrGuideCommand(chatCommand("st", "panel") as never)).toBe(false);
    expect(isHelpOrGuideCommand(chatCommand("st", "schedule", "reminder") as never)).toBe(false);
    expect(isHelpOrGuideCommand(chatCommand("nominate", null) as never)).toBe(false);
  });
});

describe("shouldDeferSlashCommand", () => {
  it("defers reminder and other /st commands except help", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "list", "reminder") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "schedule", "reminder") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "batch", "reminder") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "execute") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "add-kib") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("st", "help") as never)).toBe(false);
  });

  it("defers /game commands except help", () => {
    expect(shouldDeferSlashCommand(chatCommand("game", "setup") as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("game", "help") as never)).toBe(false);
  });

  it("does not ephemeral-defer /player help", () => {
    expect(shouldDeferSlashCommand(chatCommand("player", "help") as never)).toBe(false);
  });

  it("does not ephemeral-defer /st guide checklists", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "guide") as never)).toBe(false);
  });

  it("defers top-level day commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("nominate", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("defend", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("accusation", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("vote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("privatevote", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("roster", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("whisper", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("stats", null) as never)).toBe(true);
    expect(shouldDeferSlashCommand(chatCommand("reminder", null) as never)).toBe(true);
  });

  it("does not defer /role (public character lookup)", () => {
    expect(shouldDeferSlashCommand(chatCommand("role", null) as never)).toBe(false);
  });

  it("defers /interest create (channel.send + ephemeral ack)", () => {
    expect(shouldDeferSlashCommand(chatCommand("interest", "create") as never)).toBe(true);
  });

  it("does not ephemeral-defer modal-opening /st queue commands", () => {
    expect(shouldDeferSlashCommand(chatCommand("st", "join", "queue") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "edit", "queue") as never)).toBe(false);
    expect(shouldDeferSlashCommand(chatCommand("st", "show", "queue") as never)).toBe(true);
  });
});

describe("shouldDeferStReminderCommand", () => {
  it("matches shouldDeferSlashCommand", () => {
    expect(shouldDeferStReminderCommand(chatCommand("st", "schedule", "reminder") as never)).toBe(true);
  });
});

describe("shouldReportUnknownInteractionAck", () => {
  it("suppresses fast 10062 noise and reports near the 3s deadline", () => {
    expect(shouldReportUnknownInteractionAck(191)).toBe(false);
    expect(shouldReportUnknownInteractionAck(UNKNOWN_INTERACTION_REPORT_MIN_AGE_MS)).toBe(false);
    expect(shouldReportUnknownInteractionAck(UNKNOWN_INTERACTION_REPORT_MIN_AGE_MS + 1)).toBe(true);
  });
});

describe("startEarlyDefer", () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
  });

  it("public-defers /st guide and returns acked", async () => {
    const interaction = chatCommand("st", "guide");
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("acked");
    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("ephemeral-acks /st add-kib", async () => {
    const interaction = chatCommand("st", "add-kib");
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("acked");
    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("returns failed on unknown interaction without throwing", async () => {
    const interaction = chatCommand("st", "guide", null, {
      deferReply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("failed");
  });

  it("stays silent on early-ack 10062 (duplicate consumer / expired token)", async () => {
    const interaction = chatCommand("st", "add-kib", null, {
      createdTimestamp: Date.now() - 191,
      reply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("failed");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("stays silent even on late early-ack 10062 (winner may still have answered)", async () => {
    const interaction = chatCommand("st", "add-kib", null, {
      createdTimestamp: Date.now() - 2_800,
      reply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("failed");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns failed on already-acknowledged without throwing", async () => {
    const interaction = chatCommand("st", "guide", null, {
      deferReply: vi.fn().mockRejectedValue({ code: 40060 }),
    });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("failed");
  });

  it("returns skipped on unexpected defer errors so the handler can retry", async () => {
    const interaction = chatCommand("st", "guide", null, {
      deferReply: vi.fn().mockRejectedValue({ code: 500, message: "Internal Server Error" }),
    });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("skipped");
  });

  it("skips when already deferred", async () => {
    const interaction = chatCommand("st", "guide", null, { deferred: true });
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("acked");
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("skips modal-opening queue commands", async () => {
    const interaction = chatCommand("st", "join", "queue");
    await expect(startEarlyDefer(interaction as never)).resolves.toBe("skipped");
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

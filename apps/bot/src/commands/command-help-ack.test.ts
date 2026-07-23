import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../access.js", () => ({
  canUseBot: vi.fn().mockResolvedValue(true),
}));

vi.mock("../error-reporter.js", () => ({
  reportError: vi.fn(),
}));

import { EmbedBuilder } from "discord.js";

import { canUseBot } from "../access.js";
import { reportError } from "../error-reporter.js";
import { StGuideCommands } from "./command-help.js";

describe("StGuideCommands.setup ack handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canUseBot).mockResolvedValue(true);
  });

  function interaction(overrides: Record<string, unknown> = {}) {
    return {
      commandName: "st",
      deferred: false,
      replied: false,
      createdTimestamp: Date.now(),
      guildId: "g1",
      channelId: "c1",
      user: { id: "u1" },
      isChatInputCommand: () => true,
      options: {
        getSubcommandGroup: () => "guide",
        getSubcommand: () => "setup",
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("editReplies after a successful defer", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction();
    await cmd.setup(ix as never);
    expect(ix.deferReply).toHaveBeenCalledOnce();
    expect(ix.editReply).toHaveBeenCalledOnce();
    const payload = vi.mocked(ix.editReply).mock.calls[0]?.[0] as {
      embeds?: EmbedBuilder[];
    };
    expect(payload?.embeds?.length).toBe(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("continues to editReply after 40060 on defer (already acked)", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction({
      deferReply: vi.fn().mockRejectedValue({ code: 40060, name: "DiscordAPIError" }),
    });
    await cmd.setup(ix as never);
    expect(ix.editReply).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalledWith(
      "help.reply.failed",
      expect.anything(),
      expect.anything(),
    );
    // Must not attempt a second initial reply after already-acked.
    expect(ix.reply).not.toHaveBeenCalled();
  });

  it("reports recoverable edit failure as skipped, not failed", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction({
      deferred: true,
      createdTimestamp: Date.now() - 2_800,
      editReply: vi.fn().mockRejectedValue({ code: 40060, name: "DiscordAPIError" }),
    });
    await cmd.setup(ix as never);
    expect(reportError).toHaveBeenCalledWith(
      "help.reply.skipped",
      expect.objectContaining({ code: 40060 }),
      expect.objectContaining({ subcommandGroup: "guide", subcommand: "setup" }),
    );
    expect(reportError).not.toHaveBeenCalledWith(
      "help.reply.failed",
      expect.anything(),
      expect.anything(),
    );
    expect(ix.reply).not.toHaveBeenCalled();
  });

  it("does not error-channel spam fast unknown interactions", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction({
      createdTimestamp: Date.now() - 191,
      deferReply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await cmd.setup(ix as never);
    expect(reportError).not.toHaveBeenCalled();
    expect(ix.reply).not.toHaveBeenCalled();
    expect(ix.editReply).not.toHaveBeenCalled();
  });

  it("reports late unknown interaction as expired, not failed", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction({
      createdTimestamp: Date.now() - 2_800,
      deferReply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await cmd.setup(ix as never);
    expect(reportError).toHaveBeenCalledWith(
      "help.reply.expired",
      expect.objectContaining({ code: 10062 }),
      expect.any(Object),
    );
    expect(ix.reply).not.toHaveBeenCalled();
    expect(ix.editReply).not.toHaveBeenCalled();
  });

  it("skips defer when already deferred by early ack", async () => {
    const cmd = new StGuideCommands();
    const ix = interaction({ deferred: true });
    await cmd.setup(ix as never);
    expect(ix.deferReply).not.toHaveBeenCalled();
    expect(ix.editReply).toHaveBeenCalledOnce();
  });
});

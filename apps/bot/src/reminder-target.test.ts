import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { resolveReminderTargetChannel } from "./commands/command-context.js";

function interactionWithChannel(channel: {
  id: string;
  isThread: () => boolean;
  parentId?: string | null;
}) {
  return {
    channelId: channel.id,
    channel,
    inGuild: () => true,
    guild: { channels: { fetch: vi.fn() } },
  } as never;
}

describe("resolveReminderTargetChannel", () => {
  it("returns parent channel id when command runs in a thread", async () => {
    const interaction = interactionWithChannel({
      id: "thread-1",
      isThread: () => true,
      parentId: "channel-1",
    });

    await expect(resolveReminderTargetChannel(interaction)).resolves.toBe("channel-1");
  });

  it("returns channel id when command runs in a text channel", async () => {
    const interaction = interactionWithChannel({
      id: "channel-1",
      isThread: () => false,
    });

    await expect(resolveReminderTargetChannel(interaction)).resolves.toBe("channel-1");
  });

  it("fetches uncached thread channels to resolve the parent", async () => {
    const fetch = vi.fn().mockResolvedValue({
      id: "thread-1",
      isThread: () => true,
      parentId: "channel-1",
      type: ChannelType.PublicThread,
    });
    const interaction = {
      channelId: "thread-1",
      channel: null,
      inGuild: () => true,
      guild: { channels: { fetch } },
    } as never;

    await expect(resolveReminderTargetChannel(interaction)).resolves.toBe("channel-1");
    expect(fetch).toHaveBeenCalledWith("thread-1");
  });
});

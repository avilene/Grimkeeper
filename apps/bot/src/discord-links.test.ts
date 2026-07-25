import { describe, expect, it } from "vitest";

import {
  containsDiscordChannelUrl,
  formatMaskedDiscordLink,
  sanitizeDiscordLinkLabel,
  unwrapSuppressedDiscordChannelLinks,
} from "./discord-links.js";
import { buildReminderFireContent } from "./reminder-message.js";

describe("sanitizeDiscordLinkLabel", () => {
  it("strips bracket nick tags that would break markdown links", () => {
    expect(sanitizeDiscordLinkLabel("nomination of arlie on sharii🦀 [craboots!]")).toBe(
      "nomination of arlie on sharii🦀",
    );
  });
});

describe("formatMaskedDiscordLink", () => {
  it("builds a masked markdown jump link", () => {
    const url = "https://discord.com/channels/1/2/3";
    expect(formatMaskedDiscordLink("nomination of Moss on Moss", url)).toBe(
      `[nomination of Moss on Moss](${url})`,
    );
  });
});

describe("unwrapSuppressedDiscordChannelLinks", () => {
  const url = "https://discord.com/channels/1516869042332499978/1529845453645021315/1530526442201551019";

  it("unwraps angle-bracket suppressed links from legacy reminders", () => {
    expect(unwrapSuppressedDiscordChannelLinks(`ping (<${url}>) deadline`)).toBe(
      `ping (${url}) deadline`,
    );
    expect(unwrapSuppressedDiscordChannelLinks(`see <${url}>`)).toBe(`see ${url}`);
  });

  it("leaves modern masked links intact", () => {
    const masked = `[nomination of Moss on Moss](${url})`;
    expect(unwrapSuppressedDiscordChannelLinks(`${masked} hit the deadline`)).toBe(
      `${masked} hit the deadline`,
    );
  });
});

describe("reminder fire content with nomination URLs", () => {
  const url = "https://discord.com/channels/1/2/3";
  const fireAt = new Date("2026-07-14T08:20:00Z");

  it("preserves masked markdown links when firing", () => {
    const message = `<@1> ${formatMaskedDiscordLink("Nomination of Moss on Moss", url)} hit the 24h vote deadline — check the vote on the tracker.`;
    const fired = buildReminderFireContent(null, message, fireAt);
    expect(fired).toContain(`[Nomination of Moss on Moss](${url})`);
    expect(containsDiscordChannelUrl(fired)).toBe(true);
  });

  it("upgrades legacy suppressed links when firing", () => {
    const legacy = `<@1> Nomination of Moss on Moss (<${url}>) hit the 24h vote deadline.`;
    const fired = buildReminderFireContent(
      null,
      unwrapSuppressedDiscordChannelLinks(legacy),
      fireAt,
    );
    expect(fired).toContain(`(${url})`);
    expect(fired).not.toContain(`<${url}>`);
  });
});

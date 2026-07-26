import { describe, expect, it } from "vitest";

import { buildStHelpEmbeds } from "./help-content.js";
import {
  MESSAGE_EMBEDS_TOTAL_LIMIT,
  buildHelpPageMessage,
  helpPageButtonCustomId,
  parseHelpPageButtonCustomId,
  shouldPaginateHelp,
} from "./help-pagination.js";

function embedTextSize(embed: {
  data: {
    title?: string | null;
    description?: string | null;
    fields?: { name?: string | null; value: string }[];
    footer?: { text?: string | null } | null;
    author?: { name?: string | null } | null;
  };
}): number {
  const d = embed.data;
  let total =
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text?.length ?? 0) +
    (d.author?.name?.length ?? 0);
  for (const field of d.fields ?? []) {
    total += (field.name?.length ?? 0) + field.value.length;
  }
  return total;
}

describe("help pagination", () => {
  it("paginates ST help because combined embeds exceed Discord's message limit", () => {
    const pages = buildStHelpEmbeds();
    expect(pages.length).toBeGreaterThan(1);
    expect(shouldPaginateHelp(pages)).toBe(true);

    const combined = pages.reduce((sum, embed) => sum + embedTextSize(embed), 0);
    expect(combined).toBeGreaterThan(MESSAGE_EMBEDS_TOTAL_LIMIT);

    for (let page = 0; page < pages.length; page += 1) {
      const message = buildHelpPageMessage("st", page);
      expect(message.embeds).toHaveLength(1);
      expect(embedTextSize(message.embeds[0]!)).toBeLessThanOrEqual(MESSAGE_EMBEDS_TOTAL_LIMIT);
      expect(message.components).toHaveLength(1);
      expect(message.embeds[0]!.data.footer?.text).toContain(`Page ${page + 1}/${pages.length}`);
    }
  });

  it("round-trips help page button custom ids", () => {
    const customId = helpPageButtonCustomId("st", 2);
    expect(parseHelpPageButtonCustomId(customId)).toEqual({ scope: "st", page: 2 });
    expect(parseHelpPageButtonCustomId("gk:lock-votes:nope")).toBeNull();
  });
});

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";

import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildPlayerHelpEmbeds,
  buildStHelpEmbeds,
  type HelpSearchScope,
} from "./help-content.js";

export const HELP_PAGE_BUTTON_PREFIX = "gk:help-page:";

/** Discord allows many embeds per message, but their combined text must stay ≤ 6000. */
export const MESSAGE_EMBEDS_TOTAL_LIMIT = 6000;

export function buildHelpPages(scope: HelpSearchScope): EmbedBuilder[] {
  switch (scope) {
    case "st":
      return buildStHelpEmbeds();
    case "game":
      return buildGameHelpEmbeds();
    case "player":
      return buildPlayerHelpEmbeds();
    case "dev":
      return buildDevHelpEmbeds();
  }
}

export function helpPageButtonCustomId(scope: HelpSearchScope, page: number): string {
  return `${HELP_PAGE_BUTTON_PREFIX}${scope}:${page}`;
}

function helpPageLabelCustomId(scope: HelpSearchScope, page: number): string {
  return `${HELP_PAGE_BUTTON_PREFIX}${scope}:label:${page}`;
}

export function parseHelpPageButtonCustomId(
  customId: string,
): { scope: HelpSearchScope; page: number } | null {
  if (!customId.startsWith(HELP_PAGE_BUTTON_PREFIX)) return null;
  const rest = customId.slice(HELP_PAGE_BUTTON_PREFIX.length);
  const match = /^(st|game|player|dev):(\d+)$/.exec(rest);
  if (!match) return null;
  return { scope: match[1] as HelpSearchScope, page: Number(match[2]) };
}

function withPageFooter(embed: EmbedBuilder, page: number, total: number): EmbedBuilder {
  if (total <= 1) return embed;
  const existing = embed.data.footer?.text;
  const pageLabel = `Page ${page + 1}/${total}`;
  return EmbedBuilder.from(embed).setFooter({
    text: existing ? `${existing} · ${pageLabel}` : pageLabel,
  });
}

export function buildHelpPageComponents(
  scope: HelpSearchScope,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];

  const prev = Math.max(0, page - 1);
  const next = Math.min(totalPages - 1, page + 1);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(helpPageButtonCustomId(scope, prev))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(helpPageLabelCustomId(scope, page))
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(helpPageButtonCustomId(scope, next))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    ),
  ];
}

export function buildHelpPageMessage(
  scope: HelpSearchScope,
  page: number,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const pages = buildHelpPages(scope);
  const total = Math.max(1, pages.length);
  const safePage = Math.min(Math.max(0, page), total - 1);
  const embed = withPageFooter(pages[safePage]!, safePage, total);
  return {
    embeds: [embed],
    components: buildHelpPageComponents(scope, safePage, total),
  };
}

/** True when sending every page at once would exceed Discord's combined embed limit. */
export function shouldPaginateHelp(embeds: EmbedBuilder[]): boolean {
  if (embeds.length <= 1) return false;
  let total = 0;
  for (const embed of embeds) {
    const d = embed.data;
    total += (d.title?.length ?? 0) + (d.description?.length ?? 0);
    for (const field of d.fields ?? []) {
      total += (field.name?.length ?? 0) + field.value.length;
    }
    total += d.footer?.text?.length ?? 0;
    total += d.author?.name?.length ?? 0;
  }
  return total > MESSAGE_EMBEDS_TOTAL_LIMIT;
}

export async function handleHelpPageButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseHelpPageButtonCustomId(interaction.customId);
  if (!parsed) return false;

  const message = buildHelpPageMessage(parsed.scope, parsed.page);
  await interaction.update({
    content: null,
    embeds: message.embeds,
    components: message.components,
  });
  return true;
}

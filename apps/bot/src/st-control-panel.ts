import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type AnyThreadChannel,
  type Guild,
  type Message,
} from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

import { getStorytellerThread } from "./commands/command-context.js";

export const ST_PANEL_FOOTER_PREFIX = "grimkeeper:st-panel:";
export const ST_PANEL_BUTTON_PREFIX = "gk:st-panel:";

export type StPanelAction =
  | "resolve"
  | "votes"
  | "execute"
  | "mark-dead"
  | "mark-alive"
  | "vis-public"
  | "vis-secret"
  | "refresh";

export function stPanelFooter(gameId: string): string {
  return `${ST_PANEL_FOOTER_PREFIX}${gameId}`;
}

export function parseStPanelFooter(footerText: string | null | undefined): string | null {
  if (!footerText?.startsWith(ST_PANEL_FOOTER_PREFIX)) return null;
  return footerText.slice(ST_PANEL_FOOTER_PREFIX.length) || null;
}

export function stPanelButtonCustomId(action: StPanelAction, gameId: string): string {
  return `${ST_PANEL_BUTTON_PREFIX}${action}:${gameId}`;
}

export function parseStPanelButtonCustomId(
  customId: string,
): { action: StPanelAction; gameId: string } | null {
  if (!customId.startsWith(ST_PANEL_BUTTON_PREFIX)) return null;
  const rest = customId.slice(ST_PANEL_BUTTON_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const action = rest.slice(0, separator) as StPanelAction;
  const gameId = rest.slice(separator + 1);
  if (!gameId) return null;
  return { action, gameId };
}

export const ST_PANEL_USER_SELECT_PREFIX = "gk:st-panel-user:";

export type StPanelUserSelectAction = "execute" | "mark-dead" | "mark-alive";

export function stPanelUserSelectCustomId(
  action: StPanelUserSelectAction,
  gameId: string,
): string {
  return `${ST_PANEL_USER_SELECT_PREFIX}${action}:${gameId}`;
}

export function parseStPanelUserSelectCustomId(
  customId: string,
): { action: StPanelUserSelectAction; gameId: string } | null {
  if (!customId.startsWith(ST_PANEL_USER_SELECT_PREFIX)) return null;
  const rest = customId.slice(ST_PANEL_USER_SELECT_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const action = rest.slice(0, separator) as StPanelUserSelectAction;
  const gameId = rest.slice(separator + 1);
  if (!gameId) return null;
  return { action, gameId };
}

export function buildStControlPanelEmbed(engine: GameEngine): EmbedBuilder {
  const state = engine.getState();
  const day = state.day;
  const open = day?.nominations.filter((n) => n.status === "open").length ?? 0;
  const passed =
    day?.nominations.filter((n) => n.status === "resolved_pass").length ?? 0;
  const visibility = day?.voteVisibility ?? "public";

  return new EmbedBuilder()
    .setTitle("ST control panel")
    .setDescription(
      [
        "Live storyteller controls for this game.",
        "Type fewer slash commands — use these buttons, or `/st do` with autocomplete.",
        "",
        `Open nominations: **${open}** · Passed (awaiting execute): **${passed}**`,
        `Vote visibility: **${visibility}**`,
      ].join("\n"),
    )
    .setFooter({ text: stPanelFooter(state.gameId) });
}

export function buildStControlPanelComponents(
  engine: GameEngine,
): ActionRowBuilder<ButtonBuilder>[] {
  const gameId = engine.getState().gameId;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("resolve", gameId))
        .setLabel("Resolve next")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("execute", gameId))
        .setLabel("Execute…")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("votes", gameId))
        .setLabel("Refresh votes")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("refresh", gameId))
        .setLabel("Refresh panel")
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("mark-dead", gameId))
        .setLabel("Mark dead…")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("mark-alive", gameId))
        .setLabel("Mark alive…")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("vis-public", gameId))
        .setLabel("Public votes")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("vis-secret", gameId))
        .setLabel("Secret votes")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function findStControlPanelMessage(
  channel: AnyThreadChannel,
  gameId: string,
): Promise<Message | null> {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const message of pinned.values()) {
      if (parseStPanelFooter(message.embeds[0]?.footer?.text) === gameId) {
        return message;
      }
    }
  }
  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (!recent) return null;
  for (const message of recent.values()) {
    if (parseStPanelFooter(message.embeds[0]?.footer?.text) === gameId) {
      return message;
    }
  }
  return null;
}

export async function upsertStControlPanel(
  guild: Guild,
  parentChannelId: string,
  engine: GameEngine,
): Promise<Message | null> {
  const thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread?.isTextBased()) return null;

  const embed = buildStControlPanelEmbed(engine);
  const components = buildStControlPanelComponents(engine);
  const existing = await findStControlPanelMessage(thread, engine.getState().gameId);

  if (existing) {
    await existing.edit({ embeds: [embed], components }).catch(() => undefined);
    return existing;
  }

  const message = await thread.send({ embeds: [embed], components }).catch(() => null);
  if (message) {
    await message.pin().catch(() => undefined);
  }
  return message;
}

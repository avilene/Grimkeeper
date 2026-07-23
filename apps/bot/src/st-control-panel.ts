import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type Message,
} from "discord.js";
import type { GameEngine } from "@grimkeeper/engine";

import { getStorytellerThread, type KibVenue } from "./commands/command-context.js";

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
  | "refresh"
  | "close-noms"
  | "next-phase"
  /** Legacy control-panel button id — still handled. */
  | "next-day";

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
  const nominationsOpen = day?.nominationsOpen ?? false;
  const phaseLabel =
    state.phase === "setup"
      ? "**Setup**"
      : state.phase === "night"
        ? `Night **${state.nightNumber}**`
        : `Day **${state.dayNumber}**`;

  return new EmbedBuilder()
    .setTitle("ST control panel")
    .setDescription(
      [
        "Live storyteller controls for this game.",
        "Type fewer slash commands — use these buttons, or mobile-friendly `/st next-phase` / `/st resolve-next` / … (full catalog: `/st do`).",
        "Panel: resolve · execute · votes · close nominations · next phase · mark dead/alive · visibility.",
        "",
        `${phaseLabel} · Nominations: **${state.phase === "day" && nominationsOpen ? "open" : "closed"}**`,
        `Open nominations: **${open}** · Passed (awaiting execute): **${passed}**`,
        `Vote visibility: **${visibility}**`,
      ].join("\n"),
    )
    .setFooter({ text: stPanelFooter(state.gameId) });
}

export function buildStControlPanelComponents(
  engine: GameEngine,
): ActionRowBuilder<ButtonBuilder>[] {
  const state = engine.getState();
  const gameId = state.gameId;
  const nextPhaseLabel =
    state.phase === "setup"
      ? "Start Night 1"
      : state.phase === "night"
        ? "Start day"
        : "Start night";
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
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("close-noms", gameId))
        .setLabel("Close nominations")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(state.phase !== "day"),
      new ButtonBuilder()
        .setCustomId(stPanelButtonCustomId("next-phase", gameId))
        .setLabel(nextPhaseLabel)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function findStControlPanelMessages(channel: KibVenue): Promise<Message[]> {
  const found: Message[] = [];
  const seen = new Set<string>();
  const consider = (message: Message) => {
    if (seen.has(message.id)) return;
    if (!parseStPanelFooter(message.embeds[0]?.footer?.text)) return;
    seen.add(message.id);
    found.push(message);
  };

  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const message of pinned.values()) consider(message);
  }
  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (recent) {
    for (const message of recent.values()) consider(message);
  }
  return found;
}

async function findStControlPanelMessage(
  channel: KibVenue,
  gameId: string,
): Promise<Message | null> {
  const all = await findStControlPanelMessages(channel);
  return all.find((message) => parseStPanelFooter(message.embeds[0]?.footer?.text) === gameId) ?? null;
}

/** Disable buttons on panels for other/ended games so STs stop clicking stale customIds. */
async function retireStaleStControlPanels(
  channel: KibVenue,
  currentGameId: string,
): Promise<void> {
  const all = await findStControlPanelMessages(channel);
  await Promise.all(
    all.map(async (message) => {
      const footerGameId = parseStPanelFooter(message.embeds[0]?.footer?.text);
      if (!footerGameId || footerGameId === currentGameId) return;
      await message
        .edit({
          embeds: message.embeds,
          components: [],
          content: "_This panel is from an older game — use the current ST control panel (or `/st panel`)._",
        })
        .catch(() => undefined);
    }),
  );
}

export async function upsertStControlPanel(
  guild: Guild,
  parentChannelId: string,
  engine: GameEngine,
  kibThreadId?: string | null,
): Promise<Message | null> {
  const thread = await getStorytellerThread(guild, parentChannelId, {
    kibThreadId,
    gameId: engine.getState().gameId,
  });
  if (!thread?.isTextBased()) return null;

  const gameId = engine.getState().gameId;
  const embed = buildStControlPanelEmbed(engine);
  const components = buildStControlPanelComponents(engine);
  await retireStaleStControlPanels(thread, gameId);
  const existing = await findStControlPanelMessage(thread, gameId);

  if (existing) {
    await existing.edit({ content: null, embeds: [embed], components }).catch(() => undefined);
    return existing;
  }

  const message = await thread.send({ embeds: [embed], components }).catch(() => null);
  if (message) {
    await message.pin().catch(() => undefined);
  }
  return message;
}

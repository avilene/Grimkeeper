import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type Message,
} from "discord.js";
import {
  ensureQueueBoard,
  listOpenQueueEntries,
  parseScriptImageUrls,
  setQueuePanelMessageId,
  type StQueueEntryWithMembers,
} from "@grimkeeper/database";

export const ST_QUEUE_BUTTON_PREFIX = "gk:stq:";
export const ST_QUEUE_MODAL_PREFIX = "gk:stq-modal:";
export const ST_QUEUE_SELECT_PREFIX = "gk:stq-select:";

export type StQueueButtonAction =
  | "join"
  | "edit"
  | "leave"
  | "attach"
  | "add-cost"
  | "add-player"
  | "signup"
  | "unsignup"
  | "refresh";

export function getConfiguredQueueThreadId(): string | null {
  const raw = process.env.ST_QUEUE_THREAD_ID?.trim();
  return raw || null;
}

export function stQueueButtonCustomId(action: StQueueButtonAction, entryId?: string): string {
  const id = entryId ? `${ST_QUEUE_BUTTON_PREFIX}${action}:${entryId}` : `${ST_QUEUE_BUTTON_PREFIX}${action}`;
  return id.slice(0, 100);
}

export function parseStQueueButtonCustomId(
  customId: string,
): { action: StQueueButtonAction; entryId?: string } | null {
  if (!customId.startsWith(ST_QUEUE_BUTTON_PREFIX) || customId.startsWith(ST_QUEUE_MODAL_PREFIX)) {
    return null;
  }
  const rest = customId.slice(ST_QUEUE_BUTTON_PREFIX.length);
  const [action, entryId] = rest.split(":");
  const allowed: StQueueButtonAction[] = [
    "join",
    "edit",
    "leave",
    "attach",
    "add-cost",
    "add-player",
    "signup",
    "unsignup",
    "refresh",
  ];
  if (!action || !allowed.includes(action as StQueueButtonAction)) return null;
  return {
    action: action as StQueueButtonAction,
    entryId: entryId || undefined,
  };
}

export function stQueueModalCustomId(kind: "join" | "edit", entryId?: string): string {
  const nonce = Date.now().toString(36);
  const base =
    kind === "edit" && entryId
      ? `${ST_QUEUE_MODAL_PREFIX}edit:${entryId}:${nonce}`
      : `${ST_QUEUE_MODAL_PREFIX}join:${nonce}`;
  return base.slice(0, 100);
}

export function parseStQueueModalCustomId(
  customId: string,
): { kind: "join" | "edit"; entryId?: string } | null {
  if (!customId.startsWith(ST_QUEUE_MODAL_PREFIX)) return null;
  const rest = customId.slice(ST_QUEUE_MODAL_PREFIX.length);
  if (rest.startsWith("join:")) return { kind: "join" };
  if (rest.startsWith("edit:")) {
    const entryId = rest.slice("edit:".length).split(":")[0];
    if (!entryId) return null;
    return { kind: "edit", entryId };
  }
  return null;
}

export function stQueueSelectCustomId(kind: "co_st" | "player", entryId: string): string {
  return `${ST_QUEUE_SELECT_PREFIX}${kind}:${entryId}`.slice(0, 100);
}

export function parseStQueueSelectCustomId(
  customId: string,
): { kind: "co_st" | "player"; entryId: string } | null {
  if (!customId.startsWith(ST_QUEUE_SELECT_PREFIX)) return null;
  const rest = customId.slice(ST_QUEUE_SELECT_PREFIX.length);
  const [kind, entryId] = rest.split(":");
  if ((kind !== "co_st" && kind !== "player") || !entryId) return null;
  return { kind, entryId };
}

function mentionList(ids: string[]): string {
  if (ids.length === 0) return "—";
  return ids.map((id) => `<@${id}>`).join(", ");
}

export function formatQueueEntryBlock(entry: StQueueEntryWithMembers, index: number): string {
  const coSts = entry.members.filter((m) => m.role === "co_st").map((m) => m.discordUserId);
  const players = entry.members.filter((m) => m.role === "player").map((m) => m.discordUserId);
  const images = parseScriptImageUrls(entry.scriptImageUrls);
  const link = entry.scriptLink.trim()
    ? `[script link](${entry.scriptLink.trim()})`
    : "_no link_";
  const desc = entry.description.trim()
    ? entry.description.trim().slice(0, 280) + (entry.description.length > 280 ? "…" : "")
    : "_no description_";
  const imageLine =
    images.length > 0
      ? `Images: ${images.length} — ${images
          .slice(0, 3)
          .map((url, i) => `[#${i + 1}](${url})`)
          .join(" ")}${images.length > 3 ? " …" : ""}`
      : "Images: none (use **Attach images**)";

  return [
    `**${index + 1}. ${entry.scriptName}** — ST <@${entry.ownerDiscordId}>`,
    `Co-STs: ${mentionList(coSts)} · Players: ${mentionList(players)}`,
    `${link}`,
    desc,
    imageLine,
  ].join("\n");
}

export function buildQueueBoardEmbeds(
  entries: StQueueEntryWithMembers[],
  threadId: string,
): EmbedBuilder[] {
  const header = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle("Storyteller queue")
    .setDescription(
      [
        `Live board in <#${threadId}>. Anyone can check status with \`/st queue\`.`,
        "Join with **Join queue**, then edit / attach images / add co-STs & players.",
        entries.length === 0 ? "\n_Queue is empty — be the first!_" : `\n**${entries.length} open**`,
      ].join("\n"),
    );

  if (entries.length === 0) return [header];

  const embeds: EmbedBuilder[] = [header];
  let chunk: string[] = [];
  let chunkLen = 0;

  const flush = () => {
    if (chunk.length === 0) return;
    embeds.push(
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(chunk.join("\n\n").slice(0, 4096)),
    );
    chunk = [];
    chunkLen = 0;
  };

  entries.forEach((entry, index) => {
    const block = formatQueueEntryBlock(entry, index);
    if (chunkLen + block.length + 2 > 3800) flush();
    chunk.push(block);
    chunkLen += block.length + 2;
  });
  flush();

  return embeds.slice(0, 10);
}

export function buildQueueBoardComponents(entries: StQueueEntryWithMembers[]) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(stQueueButtonCustomId("join"))
        .setLabel("Join queue")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(stQueueButtonCustomId("refresh"))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  // Per-entry controls for the first few slots (Discord max 5 rows).
  for (const entry of entries.slice(0, 3)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(stQueueButtonCustomId("edit", entry.id))
          .setLabel(`Edit #${entry.position}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(stQueueButtonCustomId("attach", entry.id))
          .setLabel("Attach images")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(stQueueButtonCustomId("add-cost", entry.id))
          .setLabel("Add co-ST")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(stQueueButtonCustomId("signup", entry.id))
          .setLabel("Sign up")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(stQueueButtonCustomId("leave", entry.id))
          .setLabel("Leave / close")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return rows.slice(0, 5);
}

/**
 * Decide whether the live panel should be deleted + resent at the channel bottom.
 * `recentMessages` must be newest-first. Bot messages after the panel are ignored;
 * any human message after it (or the panel missing from the window) means bump.
 */
export function shouldRepostQueuePanel(
  recentMessages: ReadonlyArray<{ id: string; author: { bot: boolean | null } }>,
  panelMessageId: string,
): boolean {
  for (const msg of recentMessages) {
    if (msg.id === panelMessageId) return false;
    if (!msg.author.bot) return true;
  }
  return true;
}

async function ensurePanelPinned(message: Message): Promise<void> {
  if (message.pinned) return;
  await message.pin().catch(() => undefined);
}

export async function refreshQueuePanel(guild: Guild): Promise<{
  boardThreadId: string;
  entryCount: number;
  message: Message | null;
  reposted: boolean;
}> {
  const threadId = getConfiguredQueueThreadId();
  if (!threadId) {
    throw new Error("ST_QUEUE_THREAD_ID is not configured.");
  }

  const board = await ensureQueueBoard(guild.id, threadId);
  const entries = await listOpenQueueEntries(guild.id);
  const embeds = buildQueueBoardEmbeds(entries, board.threadId);
  const components = buildQueueBoardComponents(entries);

  const channel = await guild.channels.fetch(board.threadId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error(`Queue thread ${board.threadId} is missing or not text-based.`);
  }

  let message: Message | null = null;
  let reposted = false;

  if (board.panelMessageId) {
    message = await channel.messages.fetch(board.panelMessageId).catch(() => null);
  }

  if (message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const needsRepost = recent
      ? shouldRepostQueuePanel(
          // Discord returns newest-first; sort defensively by snowflake.
          [...recent.values()].sort((a, b) => (a.id < b.id ? 1 : -1)),
          message.id,
        )
      : false;

    if (needsRepost) {
      await message.delete().catch(() => undefined);
      message = null;
      reposted = true;
    } else {
      const edited = await message.edit({ embeds, components }).catch(() => null);
      if (edited) {
        message = edited;
        await ensurePanelPinned(message);
      } else {
        await message.delete().catch(() => undefined);
        message = null;
        reposted = true;
      }
    }
  }

  if (!message) {
    const sent = await channel.send({ embeds, components });
    await ensurePanelPinned(sent);
    await setQueuePanelMessageId(board.id, sent.id);
    message = sent;
    reposted = true;
  }

  return { boardThreadId: board.threadId, entryCount: entries.length, message, reposted };
}

export function buildQueueStatusContent(entries: StQueueEntryWithMembers[], threadId: string): string {
  if (entries.length === 0) {
    return `ST queue is empty. Board: <#${threadId}> — use **Join queue** there or \`/st queue join\`.`;
  }
  const lines = entries.map((entry, index) => {
    const players = entry.members.filter((m) => m.role === "player").length;
    const co = entry.members.filter((m) => m.role === "co_st").length;
    return `${index + 1}. **${entry.scriptName}** — <@${entry.ownerDiscordId}> (co-ST ${co}, players ${players})`;
  });
  return [`ST queue (**${entries.length}** open) — board <#${threadId}>:`, ...lines].join("\n");
}

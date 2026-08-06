import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import {
  signupsByState,
  type InterestPostWithSignups,
  type InterestSignupState,
} from "@grimkeeper/database";

export const INTEREST_BUTTON_PREFIX = "gk:interest:";
export const INTEREST_MODAL_PREFIX = "gk:interest-modal:";
export const INTEREST_CONFIRM_PREFIX = "gk:interest-confirm:";

export type InterestPublicAction = InterestSignupState;
export type InterestOwnerAction = "edit" | "close" | "delete";
export type InterestConfirmAction = "delete-yes" | "delete-no";

export type InterestButtonAction = InterestPublicAction | InterestOwnerAction;

const PUBLIC_ACTIONS: InterestPublicAction[] = ["playing", "kib", "backup"];
const OWNER_ACTIONS: InterestOwnerAction[] = ["edit", "close", "delete"];

export function interestButtonCustomId(action: InterestButtonAction, interestId: string): string {
  return `${INTEREST_BUTTON_PREFIX}${action}:${interestId}`.slice(0, 100);
}

export function parseInterestButtonCustomId(
  customId: string,
): { action: InterestButtonAction; interestId: string } | null {
  if (!customId.startsWith(INTEREST_BUTTON_PREFIX)) return null;
  const rest = customId.slice(INTEREST_BUTTON_PREFIX.length);
  const [action, interestId] = rest.split(":");
  if (!action || !interestId) return null;
  if (
    !(PUBLIC_ACTIONS as string[]).includes(action) &&
    !(OWNER_ACTIONS as string[]).includes(action)
  ) {
    return null;
  }
  return { action: action as InterestButtonAction, interestId };
}

export function interestModalCustomId(interestId: string): string {
  const nonce = Date.now().toString(36);
  return `${INTEREST_MODAL_PREFIX}edit:${interestId}:${nonce}`.slice(0, 100);
}

export function parseInterestModalCustomId(
  customId: string,
): { interestId: string } | null {
  if (!customId.startsWith(INTEREST_MODAL_PREFIX)) return null;
  const rest = customId.slice(INTEREST_MODAL_PREFIX.length);
  if (!rest.startsWith("edit:")) return null;
  const interestId = rest.slice("edit:".length).split(":")[0];
  if (!interestId) return null;
  return { interestId };
}

export function interestConfirmCustomId(
  action: InterestConfirmAction,
  interestId: string,
): string {
  return `${INTEREST_CONFIRM_PREFIX}${action}:${interestId}`.slice(0, 100);
}

export function parseInterestConfirmCustomId(
  customId: string,
): { action: InterestConfirmAction; interestId: string } | null {
  if (!customId.startsWith(INTEREST_CONFIRM_PREFIX)) return null;
  const rest = customId.slice(INTEREST_CONFIRM_PREFIX.length);
  const [action, interestId] = rest.split(":");
  if ((action !== "delete-yes" && action !== "delete-no") || !interestId) return null;
  return { action, interestId };
}

function mentionList(ids: string[]): string {
  if (ids.length === 0) return "_Nobody yet_";
  return ids.map((id) => `<@${id}>`).join("\n");
}

function playingCountLabel(count: number, maxPlayers: number | null | undefined): string {
  if (maxPlayers != null && maxPlayers > 0) {
    return `${count}/${maxPlayers}`;
  }
  return String(count);
}

/** Best-effort script name from a BotC Scripts URL path (no network). */
export function guessScriptLabel(scriptUrl: string, fallbackTitle: string): string {
  const trimmed = scriptUrl.trim();
  if (!trimmed) return fallbackTitle;
  try {
    const url = new URL(trimmed);
    if (!/botcscripts\.com$/i.test(url.hostname) && !/\.botcscripts\.com$/i.test(url.hostname)) {
      return fallbackTitle;
    }
    // /script/123 or /script/sect-and-violets — prefer slug when non-numeric
    const parts = url.pathname.split("/").filter(Boolean);
    const scriptIdx = parts.findIndex((p) => p.toLowerCase() === "script");
    const slug = scriptIdx >= 0 ? parts[scriptIdx + 1] : undefined;
    if (slug && !/^\d+$/.test(slug)) {
      return slug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .slice(0, 100);
    }
  } catch {
    // ignore invalid URLs
  }
  return fallbackTitle;
}

export function buildInterestEmbed(post: NonNullable<InterestPostWithSignups>): EmbedBuilder {
  const { playing, kib, backup } = signupsByState(post);
  const closed = post.closed;
  const title = closed ? `🔒 Interest Check (Closed)` : `🎲 Interest Check`;
  const scriptUrl = post.scriptUrl.trim();
  const description = post.description.trim();

  const lines: string[] = [`**${post.title}**`];

  if (scriptUrl) {
    const label = guessScriptLabel(scriptUrl, post.title);
    lines.push(`📜 **Script** — [${label}](${scriptUrl})`);
  }

  if (description) {
    lines.push(`\n> ${description.replace(/\n/g, "\n> ")}`);
  }

  lines.push("");
  lines.push(`## 🎮 Playing (${playingCountLabel(playing.length, post.maxPlayers)})`);
  lines.push(mentionList(playing));
  lines.push("");
  lines.push(`## 👀 KIB (${kib.length})`);
  lines.push(mentionList(kib));
  lines.push("");
  lines.push(`## 🛟 Backup (${backup.length})`);
  lines.push(mentionList(backup));

  if (post.maxPlayers != null && post.maxPlayers > 0) {
    lines.push("");
    lines.push(`_Max players: ${post.maxPlayers}_`);
  }

  const embed = new EmbedBuilder()
    .setColor(closed ? 0x747f8d : 0x57f287)
    .setTitle(title)
    .setDescription(lines.join("\n").slice(0, 4096))
    .setTimestamp(post.createdAt)
    .addFields({ name: "Organizer", value: `<@${post.ownerId}>`, inline: true });

  const imageUrl = post.imageUrl.trim();
  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

export function buildInterestComponents(post: NonNullable<InterestPostWithSignups>) {
  const disabled = post.closed;
  const publicRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("playing", post.id))
      .setLabel("Sign Up")
      .setEmoji("🎮")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("kib", post.id))
      .setLabel("Keep in Mind")
      .setEmoji("👀")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("backup", post.id))
      .setLabel("Backup")
      .setEmoji("🛟")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

  const ownerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("edit", post.id))
      .setLabel("Edit")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("close", post.id))
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(interestButtonCustomId("delete", post.id))
      .setLabel("Delete")
      .setEmoji("🗑")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(false),
  );

  return [publicRow, ownerRow];
}

export function buildInterestMessagePayload(post: NonNullable<InterestPostWithSignups>) {
  return {
    embeds: [buildInterestEmbed(post)],
    components: buildInterestComponents(post),
  };
}

export function buildDeleteConfirmComponents(interestId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(interestConfirmCustomId("delete-yes", interestId))
        .setLabel("Delete permanently")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(interestConfirmCustomId("delete-no", interestId))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

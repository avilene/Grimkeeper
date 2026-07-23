import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import {
  addQueueMember,
  appendQueueEntryImages,
  closeQueueEntry,
  createQueueEntry,
  ensureQueueBoard,
  findOpenEntryForOwner,
  getQueueEntryById,
  listOpenQueueEntries,
  parseScriptImageUrls,
  removeQueueMember,
  removeQueueMemberSelf,
  updateQueueEntry,
} from "@grimkeeper/database";

import { canUseBot } from "../access.js";
import { reportError } from "../error-reporter.js";
import {
  getConfiguredQueueThreadId,
  parseStQueueButtonCustomId,
  parseStQueueModalCustomId,
  parseStQueueSelectCustomId,
  refreshQueuePanel,
  stQueueModalCustomId,
  stQueueSelectCustomId,
} from "../st-queue-board.js";
import {
  interactionCreatedAgeMs,
  isRecoverableInteractionResponseError,
  isUnknownInteractionError,
  shouldReportUnknownInteractionAck,
} from "./interaction-response.js";

const FIELD_SCRIPT_NAME = "script_name";
const FIELD_SCRIPT_LINK = "script_link";
const FIELD_DESCRIPTION = "description";
const FIELD_IMAGE_URLS = "image_urls";

const ATTACH_WAIT_MS = 120_000;
const pendingAttach = new Map<string, { entryId: string; expiresAt: number }>();

function splitImageUrls(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
}

async function ensureDeferred(
  interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function safeEdit(
  interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, components: [], embeds: [] });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (!isRecoverableInteractionResponseError(error)) throw error;
    if (isUnknownInteractionError(error)) {
      const ageMs = interactionCreatedAgeMs(interaction);
      if (!shouldReportUnknownInteractionAck(ageMs)) return;
      void reportError("stQueue.reply.unknown", error, {
        customId: interaction.customId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        ageMs,
      });
    }
  }
}

async function requireQueueAccess(
  interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  // canUseBot expects CommandInteraction-shaped access; reuse allowlist via cast of user/guild.
  const allowed = await canUseBot(interaction as never);
  if (!allowed) {
    await safeEdit(
      interaction,
      "You are not allowed to use this bot. Ask an admin to add you to the allowlist.",
    );
    return false;
  }
  return true;
}

function buildEntryModal(kind: "join" | "edit", entryId?: string, defaults?: {
  scriptName?: string;
  scriptLink?: string;
  description?: string;
  imageUrls?: string[];
}) {
  const modal = new ModalBuilder()
    .setCustomId(stQueueModalCustomId(kind, entryId))
    .setTitle(kind === "join" ? "Join ST queue" : "Edit queue entry");

  const nameInput = new TextInputBuilder()
    .setCustomId(FIELD_SCRIPT_NAME)
    .setLabel("Script name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  if (defaults?.scriptName) nameInput.setValue(defaults.scriptName.slice(0, 100));

  const linkInput = new TextInputBuilder()
    .setCustomId(FIELD_SCRIPT_LINK)
    .setLabel("Script link (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);
  if (defaults?.scriptLink) linkInput.setValue(defaults.scriptLink.slice(0, 500));

  const descInput = new TextInputBuilder()
    .setCustomId(FIELD_DESCRIPTION)
    .setLabel("Description / notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1800);
  if (defaults?.description) descInput.setValue(defaults.description.slice(0, 1800));

  const imagesInput = new TextInputBuilder()
    .setCustomId(FIELD_IMAGE_URLS)
    .setLabel("Image URLs (optional, space-separated)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Or use Attach images after joining");
  const joinedImages = (defaults?.imageUrls ?? []).join(" ").slice(0, 1000);
  if (joinedImages) imagesInput.setValue(joinedImages);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(linkInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(imagesInput),
  );

  return modal;
}

export async function showJoinQueueModal(
  interaction: ButtonInteraction | import("discord.js").CommandInteraction,
): Promise<void> {
  await interaction.showModal(buildEntryModal("join"));
}

export async function showEditQueueModal(
  interaction: ButtonInteraction | import("discord.js").CommandInteraction,
  entryId: string,
): Promise<void> {
  const entry = await getQueueEntryById(entryId);
  if (!entry || entry.status !== "open") {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "That queue entry is gone.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }
  await interaction.showModal(
    buildEntryModal("edit", entry.id, {
      scriptName: entry.scriptName,
      scriptLink: entry.scriptLink,
      description: entry.description,
      imageUrls: parseScriptImageUrls(entry.scriptImageUrls),
    }),
  );
}

async function refreshPanelQuiet(guild: NonNullable<ButtonInteraction["guild"]>) {
  try {
    await refreshQueuePanel(guild);
  } catch {
    // Panel refresh is best-effort after mutations.
  }
}

function startAttachCollector(
  interaction: ButtonInteraction | import("discord.js").CommandInteraction,
  entryId: string,
): void {
  const userId = interaction.user.id;
  pendingAttach.set(userId, { entryId, expiresAt: Date.now() + ATTACH_WAIT_MS });

  const channel = interaction.channel;
  if (!channel || !("createMessageCollector" in channel)) return;

  const collector = channel.createMessageCollector({
    filter: (message: Message) =>
      message.author.id === userId && message.attachments.size > 0,
    time: ATTACH_WAIT_MS,
    max: 5,
  });

  collector.on("collect", async (message) => {
    const pending = pendingAttach.get(userId);
    if (!pending || pending.entryId !== entryId) return;
    const urls = [...message.attachments.values()]
      .filter((att) => (att.contentType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(att.name ?? ""))
      .map((att) => att.url);
    if (urls.length === 0) return;

    const entry = await getQueueEntryById(entryId);
    if (!entry || entry.ownerDiscordId !== userId || entry.status !== "open") {
      collector.stop("unauthorized");
      return;
    }
    await appendQueueEntryImages(entryId, urls);
    if (message.guild) await refreshPanelQuiet(message.guild);
    await message.react("✅").catch(() => undefined);
  });

  collector.on("end", () => {
    const pending = pendingAttach.get(userId);
    if (pending?.entryId === entryId) pendingAttach.delete(userId);
  });
}

export async function handleStQueueButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseStQueueButtonCustomId(interaction.customId);
  if (!parsed) return false;

  if (!(await requireQueueAccess(interaction))) return true;

  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    await interaction.reply({
      content: "Use this in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const threadId = getConfiguredQueueThreadId();
  if (!threadId) {
    await interaction.reply({
      content: "ST queue is not configured (`ST_QUEUE_THREAD_ID`).",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    switch (parsed.action) {
      case "join": {
        const existing = await findOpenEntryForOwner(guild.id, interaction.user.id);
        if (existing) {
          await interaction.reply({
            content: `You already have an open entry (**${existing.scriptName}**). Edit it instead.`,
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }
        await showJoinQueueModal(interaction);
        return true;
      }
      case "edit": {
        if (!parsed.entryId) return true;
        const entry = await getQueueEntryById(parsed.entryId);
        if (!entry || entry.ownerDiscordId !== interaction.user.id) {
          await interaction.reply({
            content: "Only the entry owner can edit it.",
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }
        await showEditQueueModal(interaction, entry.id);
        return true;
      }
      case "refresh": {
        await ensureDeferred(interaction);
        const result = await refreshQueuePanel(guild);
        await safeEdit(
          interaction,
          `Queue panel refreshed in <#${result.boardThreadId}> (${result.entryCount} open).`,
        );
        return true;
      }
      case "leave": {
        await ensureDeferred(interaction);
        if (!parsed.entryId) {
          await safeEdit(interaction, "Missing entry.");
          return true;
        }
        const entry = await getQueueEntryById(parsed.entryId);
        if (!entry || entry.status !== "open") {
          await safeEdit(interaction, "That entry is gone.");
          return true;
        }
        if (entry.ownerDiscordId === interaction.user.id) {
          await closeQueueEntry(entry.id);
          await refreshPanelQuiet(guild);
          await safeEdit(interaction, `Closed your queue entry (**${entry.scriptName}**).`);
          return true;
        }
        const wasMember = entry.members.some((m) => m.discordUserId === interaction.user.id);
        if (!wasMember) {
          await safeEdit(interaction, "You are not on that entry.");
          return true;
        }
        await removeQueueMemberSelf(entry.id, interaction.user.id);
        await refreshPanelQuiet(guild);
        await safeEdit(interaction, `Removed you from **${entry.scriptName}**.`);
        return true;
      }
      case "attach": {
        await ensureDeferred(interaction);
        if (!parsed.entryId) {
          await safeEdit(interaction, "Missing entry.");
          return true;
        }
        const entry = await getQueueEntryById(parsed.entryId);
        if (!entry || entry.ownerDiscordId !== interaction.user.id || entry.status !== "open") {
          await safeEdit(interaction, "Only the entry owner can attach images.");
          return true;
        }
        startAttachCollector(interaction, entry.id);
        await safeEdit(
          interaction,
          `Send image attachments in this channel within 2 minutes — I'll add them to **${entry.scriptName}**.`,
        );
        return true;
      }
      case "add-cost":
      case "add-player": {
        await ensureDeferred(interaction);
        if (!parsed.entryId) {
          await safeEdit(interaction, "Missing entry.");
          return true;
        }
        const entry = await getQueueEntryById(parsed.entryId);
        if (!entry || entry.ownerDiscordId !== interaction.user.id || entry.status !== "open") {
          await safeEdit(interaction, "Only the entry owner can add people.");
          return true;
        }
        const kind = parsed.action === "add-cost" ? "co_st" : "player";
        const select = new UserSelectMenuBuilder()
          .setCustomId(stQueueSelectCustomId(kind, entry.id))
          .setPlaceholder(kind === "co_st" ? "Select co-storyteller(s)" : "Select player(s)")
          .setMinValues(1)
          .setMaxValues(10);
        await interaction.editReply({
          content: kind === "co_st" ? "Pick co-storyteller(s):" : "Pick player(s) to add:",
          components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
        });
        return true;
      }
      case "signup": {
        await ensureDeferred(interaction);
        if (!parsed.entryId) {
          await safeEdit(interaction, "Missing entry.");
          return true;
        }
        const entry = await getQueueEntryById(parsed.entryId);
        if (!entry || entry.status !== "open") {
          await safeEdit(interaction, "That entry is gone.");
          return true;
        }
        if (entry.ownerDiscordId === interaction.user.id) {
          await safeEdit(interaction, "You're already the ST for this entry.");
          return true;
        }
        const already = entry.members.some(
          (m) => m.discordUserId === interaction.user.id && m.role === "player",
        );
        if (already) {
          await removeQueueMember(entry.id, interaction.user.id, "player");
          await refreshPanelQuiet(guild);
          await safeEdit(interaction, `Removed your player signup from **${entry.scriptName}**.`);
          return true;
        }
        await addQueueMember(entry.id, interaction.user.id, "player");
        await refreshPanelQuiet(guild);
        await safeEdit(interaction, `Signed up as a player for **${entry.scriptName}**.`);
        return true;
      }
      case "unsignup": {
        await ensureDeferred(interaction);
        if (!parsed.entryId) return true;
        await removeQueueMemberSelf(parsed.entryId, interaction.user.id);
        await refreshPanelQuiet(guild);
        await safeEdit(interaction, "Removed you from that entry.");
        return true;
      }
      default:
        return true;
    }
  } catch (error) {
    await ensureDeferred(interaction).catch(() => undefined);
    await safeEdit(
      interaction,
      error instanceof Error ? error.message : "Queue action failed.",
    );
    return true;
  }
}

export async function handleStQueueModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const parsed = parseStQueueModalCustomId(interaction.customId);
  if (!parsed) return false;

  if (!(await requireQueueAccess(interaction))) return true;

  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    await interaction.reply({
      content: "Use this in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const threadId = getConfiguredQueueThreadId();
  if (!threadId) {
    await interaction.reply({
      content: "ST queue is not configured (`ST_QUEUE_THREAD_ID`).",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const scriptName = interaction.fields.getTextInputValue(FIELD_SCRIPT_NAME);
  const scriptLink = interaction.fields.getTextInputValue(FIELD_SCRIPT_LINK);
  const description = interaction.fields.getTextInputValue(FIELD_DESCRIPTION);
  const imageUrls = splitImageUrls(interaction.fields.getTextInputValue(FIELD_IMAGE_URLS));

  try {
    if (parsed.kind === "join") {
      const existing = await findOpenEntryForOwner(guild.id, interaction.user.id);
      if (existing) {
        await safeEdit(
          interaction,
          `You already have an open entry (**${existing.scriptName}**).`,
        );
        return true;
      }
      const board = await ensureQueueBoard(guild.id, threadId);
      const entry = await createQueueEntry({
        boardId: board.id,
        guildId: guild.id,
        ownerDiscordId: interaction.user.id,
        scriptName,
        scriptLink,
        description,
        scriptImageUrls: imageUrls,
      });
      await refreshPanelQuiet(guild);
      await safeEdit(
        interaction,
        `Joined the ST queue with **${entry.scriptName}**. Board: <#${threadId}>. Use **Attach images** to add screenshots.`,
      );
      return true;
    }

    if (!parsed.entryId) {
      await safeEdit(interaction, "Missing entry.");
      return true;
    }
    const entry = await getQueueEntryById(parsed.entryId);
    if (!entry || entry.ownerDiscordId !== interaction.user.id || entry.status !== "open") {
      await safeEdit(interaction, "Only the owner can edit this entry.");
      return true;
    }
    const mergedImages =
      imageUrls.length > 0 ? imageUrls : parseScriptImageUrls(entry.scriptImageUrls);
    await updateQueueEntry(entry.id, {
      scriptName,
      scriptLink,
      description,
      scriptImageUrls: mergedImages,
    });
    await refreshPanelQuiet(guild);
    await safeEdit(interaction, `Updated **${scriptName.trim() || entry.scriptName}**.`);
    return true;
  } catch (error) {
    await safeEdit(
      interaction,
      error instanceof Error ? error.message : "Could not save queue entry.",
    );
    return true;
  }
}

export async function handleStQueueUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<boolean> {
  const parsed = parseStQueueSelectCustomId(interaction.customId);
  if (!parsed) return false;

  await ensureDeferred(interaction);
  if (!(await requireQueueAccess(interaction))) return true;

  const guild = interaction.guild;
  if (!guild) {
    await safeEdit(interaction, "Use this in a server.");
    return true;
  }

  const entry = await getQueueEntryById(parsed.entryId);
  if (!entry || entry.ownerDiscordId !== interaction.user.id || entry.status !== "open") {
    await safeEdit(interaction, "Only the entry owner can add people.");
    return true;
  }

  const users = interaction.users;
  let added = 0;
  for (const [userId] of users) {
    if (userId === entry.ownerDiscordId) continue;
    await addQueueMember(entry.id, userId, parsed.kind);
    added++;
  }
  await refreshPanelQuiet(guild);
  await safeEdit(
    interaction,
    added > 0
      ? `Added ${added} ${parsed.kind === "co_st" ? "co-ST(s)" : "player(s)"} to **${entry.scriptName}**.`
      : "No one was added.",
  );
  return true;
}

/** Used by slash `/st queue attach` for the caller's open entry. */
export async function beginAttachForOwner(
  interaction: import("discord.js").CommandInteraction,
): Promise<string> {
  if (!interaction.guildId) return "Use this in a server.";
  const entry = await findOpenEntryForOwner(interaction.guildId, interaction.user.id);
  if (!entry) return "You don't have an open queue entry. Use `/st queue join` first.";
  startAttachCollector(interaction, entry.id);
  return `Send image attachments in this channel within 2 minutes — I'll add them to **${entry.scriptName}**.`;
}

export async function listQueueStatusText(guildId: string): Promise<string> {
  const threadId = getConfiguredQueueThreadId();
  if (!threadId) return "ST queue is not configured (`ST_QUEUE_THREAD_ID`).";
  const entries = await listOpenQueueEntries(guildId);
  const { buildQueueStatusContent } = await import("../st-queue-board.js");
  return buildQueueStatusContent(entries, threadId);
}

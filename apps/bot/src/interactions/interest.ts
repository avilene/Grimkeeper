import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  closeInterestPost,
  deleteInterestPost,
  getInterestPostById,
  setInterestSignup,
  updateInterestPost,
  type InterestSignupState,
} from "@grimkeeper/database";

import {
  fetchGuildMemberWithTimeout,
  getAdminRoleIds,
  isAllowedUserId,
  canUseBot,
  type AccessInteraction,
} from "../access.js";
import { reportError } from "../error-reporter.js";
import {
  buildDeleteConfirmComponents,
  buildInterestMessagePayload,
  interestModalCustomId,
  parseInterestButtonCustomId,
  parseInterestConfirmCustomId,
  parseInterestModalCustomId,
} from "../interest-post.js";
import {
  interactionCreatedAgeMs,
  isRecoverableInteractionResponseError,
  isUnknownInteractionError,
  shouldReportUnknownInteractionAck,
} from "./interaction-response.js";

const FIELD_TITLE = "title";
const FIELD_DESCRIPTION = "description";
const FIELD_SCRIPT_URL = "script_url";

const MISSING_CHANNEL_ACCESS =
  "Couldn't update the interest post in this channel. Add the Grimkeeper bot with **View Channel** and **Send Messages**, then try again.";

function isMissingAccessError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === 50001,
  );
}

async function ensureDeferred(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/**
 * Ephemeral ack for the clicker. After `interaction.update()` the interaction is
 * already replied — use followUp so we don't overwrite the public interest post.
 */
async function safeEdit(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  content: string,
  components?: ReturnType<typeof buildDeleteConfirmComponents>,
): Promise<void> {
  const payload = {
    content,
    components: components ?? [],
    embeds: [] as never[],
  };
  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
      return;
    }
    if (interaction.replied) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    if (!isRecoverableInteractionResponseError(error)) throw error;
    if (isUnknownInteractionError(error)) {
      const ageMs = interactionCreatedAgeMs(interaction);
      if (!shouldReportUnknownInteractionAck(ageMs)) return;
      void reportError("interest.reply.unknown", error, {
        customId: interaction.customId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        ageMs,
      });
    }
  }
}

async function requireInterestAccess(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  const allowed = await canUseBot(interaction as AccessInteraction);
  if (!allowed) {
    await safeEdit(
      interaction,
      "You are not allowed to use this bot. Ask an admin to add you to the allowlist.",
    );
    return false;
  }
  return true;
}

export async function canManageInterestPost(
  interaction: AccessInteraction,
  ownerId: string,
): Promise<boolean> {
  const userId = interaction.user?.id;
  if (!userId) return false;
  if (userId === ownerId) return true;
  if (isAllowedUserId(userId)) return true;

  const adminRoleIds = getAdminRoleIds();
  if (adminRoleIds.size === 0 || !interaction.guild) return false;

  const member = await fetchGuildMemberWithTimeout(interaction.guild, userId, undefined, {
    force: true,
  });
  if (!member) return false;
  return member.roles.cache.some((role) => adminRoleIds.has(role.id));
}

function buildEditModal(post: {
  id: string;
  title: string;
  description: string;
  scriptUrl: string;
}) {
  const modal = new ModalBuilder()
    .setCustomId(interestModalCustomId(post.id))
    .setTitle("Edit interest check");

  const titleInput = new TextInputBuilder()
    .setCustomId(FIELD_TITLE)
    .setLabel("Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setValue(post.title.slice(0, 100));

  const descInput = new TextInputBuilder()
    .setCustomId(FIELD_DESCRIPTION)
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1800);
  if (post.description.trim()) descInput.setValue(post.description.slice(0, 1800));

  const scriptInput = new TextInputBuilder()
    .setCustomId(FIELD_SCRIPT_URL)
    .setLabel("Script URL")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);
  if (post.scriptUrl.trim()) scriptInput.setValue(post.scriptUrl.slice(0, 500));

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(scriptInput),
  );

  return modal;
}

/**
 * Refresh the public interest message.
 * Prefer `interaction.update()` on button clicks — that uses the interaction token and
 * does not require View Channel (unlike `message.edit()` via the channel REST API).
 */
async function refreshInterestMessage(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  post: NonNullable<Awaited<ReturnType<typeof getInterestPostById>>>,
): Promise<"updated" | "edited" | "missing-access" | "skipped"> {
  const payload = buildInterestMessagePayload(post);

  if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
    try {
      await interaction.update(payload);
      return "updated";
    } catch (error) {
      if (isMissingAccessError(error)) return "missing-access";
      throw error;
    }
  }

  try {
    if (interaction.isButton() && interaction.message) {
      await interaction.message.edit(payload);
      return "edited";
    }
    if (!post.messageId || !interaction.channel || !("messages" in interaction.channel)) {
      return "skipped";
    }
    const message = await interaction.channel.messages.fetch(post.messageId).catch(() => null);
    if (!message) return "skipped";
    await message.edit(payload);
    return "edited";
  } catch (error) {
    if (isMissingAccessError(error)) {
      void reportError("interest.refresh.missing_access", error, {
        interestId: post.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
      });
      return "missing-access";
    }
    throw error;
  }
}

const SIGNUP_LABEL: Record<InterestSignupState, string> = {
  playing: "Playing",
  kib: "KIB",
  backup: "Backup",
};

export async function handleInterestButton(interaction: ButtonInteraction): Promise<boolean> {
  const confirm = parseInterestConfirmCustomId(interaction.customId);
  if (confirm) {
    return handleInterestConfirm(interaction, confirm.action, confirm.interestId);
  }

  const parsed = parseInterestButtonCustomId(interaction.customId);
  if (!parsed) return false;

  if (!(await requireInterestAccess(interaction))) return true;

  const post = await getInterestPostById(parsed.interestId);
  if (!post) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "That interest check no longer exists.");
    return true;
  }

  if (parsed.action === "playing" || parsed.action === "kib" || parsed.action === "backup") {
    if (post.closed) {
      await ensureDeferred(interaction);
      await safeEdit(interaction, "This interest check is closed.");
      return true;
    }

    const updated = await setInterestSignup(post.id, interaction.user.id, parsed.action);
    if (!updated) {
      await ensureDeferred(interaction);
      await safeEdit(interaction, "Couldn't update your signup.");
      return true;
    }

    const refresh = await refreshInterestMessage(interaction, updated);
    await ensureDeferred(interaction);

    if (refresh === "missing-access") {
      await safeEdit(interaction, MISSING_CHANNEL_ACCESS);
      return true;
    }

    const still = updated.signups.find((s) => s.userId === interaction.user.id);
    if (!still) {
      await safeEdit(interaction, `Removed you from **${updated.title}**.`);
    } else {
      await safeEdit(
        interaction,
        `You're on **${SIGNUP_LABEL[still.state as InterestSignupState] ?? still.state}** for **${updated.title}**.`,
      );
    }
    return true;
  }

  if (!(await canManageInterestPost(interaction, post.ownerId))) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "Only the organizer (or a server admin) can do that.");
    return true;
  }

  if (parsed.action === "edit") {
    if (post.closed) {
      await ensureDeferred(interaction);
      await safeEdit(interaction, "This interest check is closed — reopen isn't supported; create a new one.");
      return true;
    }
    await interaction.showModal(
      buildEditModal({
        id: post.id,
        title: post.title,
        description: post.description,
        scriptUrl: post.scriptUrl,
      }),
    );
    return true;
  }

  if (parsed.action === "close") {
    if (post.closed) {
      await ensureDeferred(interaction);
      await safeEdit(interaction, "Already closed.");
      return true;
    }
    const updated = await closeInterestPost(post.id);
    const refresh = await refreshInterestMessage(interaction, updated);
    await ensureDeferred(interaction);
    if (refresh === "missing-access") {
      await safeEdit(interaction, `Closed **${updated.title}**, but ${MISSING_CHANNEL_ACCESS}`);
      return true;
    }
    await safeEdit(interaction, `Closed **${updated.title}**. Signups are locked.`);
    return true;
  }

  if (parsed.action === "delete") {
    await ensureDeferred(interaction);
    await safeEdit(
      interaction,
      `Delete **${post.title}** permanently? This removes the post and all signups.`,
      buildDeleteConfirmComponents(post.id),
    );
    return true;
  }

  return true;
}

async function handleInterestConfirm(
  interaction: ButtonInteraction,
  action: "delete-yes" | "delete-no",
  interestId: string,
): Promise<boolean> {
  if (!(await requireInterestAccess(interaction))) return true;

  const post = await getInterestPostById(interestId);
  if (!post) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "That interest check is already gone.");
    return true;
  }

  if (!(await canManageInterestPost(interaction, post.ownerId))) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "Only the organizer (or a server admin) can do that.");
    return true;
  }

  if (action === "delete-no") {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "Delete cancelled.");
    return true;
  }

  const messageId = post.messageId;
  const channel = interaction.channel;
  await deleteInterestPost(post.id);

  if (messageId && channel && "messages" in channel) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await message.delete().catch(() => undefined);
  } else if (interaction.message?.id === messageId) {
    await interaction.message.delete().catch(() => undefined);
  }

  await ensureDeferred(interaction);
  await safeEdit(interaction, `Deleted **${post.title}**.`);
  return true;
}

export async function handleInterestModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const parsed = parseInterestModalCustomId(interaction.customId);
  if (!parsed) return false;

  if (!(await requireInterestAccess(interaction))) return true;

  const post = await getInterestPostById(parsed.interestId);
  if (!post) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "That interest check no longer exists.");
    return true;
  }

  if (!(await canManageInterestPost(interaction, post.ownerId))) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "Only the organizer (or a server admin) can edit this.");
    return true;
  }

  if (post.closed) {
    await ensureDeferred(interaction);
    await safeEdit(interaction, "This interest check is closed.");
    return true;
  }

  const title = interaction.fields.getTextInputValue(FIELD_TITLE);
  const description = interaction.fields.getTextInputValue(FIELD_DESCRIPTION);
  const scriptUrl = interaction.fields.getTextInputValue(FIELD_SCRIPT_URL);

  const updated = await updateInterestPost(post.id, {
    title,
    description,
    scriptUrl,
  });

  // Modal submit can't update() the interest message — needs channel access.
  const refresh = await refreshInterestMessage(interaction, updated);
  await ensureDeferred(interaction);
  if (refresh === "missing-access") {
    await safeEdit(
      interaction,
      `Saved **${updated.title}** in the database, but ${MISSING_CHANNEL_ACCESS}`,
    );
    return true;
  }
  await safeEdit(interaction, `Updated **${updated.title}**.`);
  return true;
}

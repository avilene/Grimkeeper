import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type SendableChannels,
} from "discord.js";
import { getGameById, prisma } from "@grimkeeper/database";
import {
  GameCommandKind,
  type GameEngine,
  listBotcRoles,
} from "@grimkeeper/engine";

import {
  canActAsStoryteller,
  getKibThreadForGame,
  loadEngine,
  persistEvents,
  replyEngineError,
  syncGameProjection,
} from "../commands/command-context.js";
import { buildRoleDmEmbed } from "../role-embed.js";
import { upsertPinnedGameStatus } from "../game-status.js";
import { postGameLog } from "../game-log-thread.js";

export const BUFFET_PICK_PREFIX = "gk:buffet:pick:";
export const BUFFET_MULLIGAN_PREFIX = "gk:buffet:mulligan:";

export function buffetPickCustomId(gameId: string, roleId: string): string {
  return `${BUFFET_PICK_PREFIX}${gameId}|${roleId}`;
}

export function buffetMulliganCustomId(gameId: string): string {
  return `${BUFFET_MULLIGAN_PREFIX}${gameId}`;
}

export function parseBuffetPickCustomId(
  customId: string,
): { gameId: string; roleId: string } | null {
  if (!customId.startsWith(BUFFET_PICK_PREFIX)) return null;
  const payload = customId.slice(BUFFET_PICK_PREFIX.length);
  const sep = payload.indexOf("|");
  if (sep < 0) return null;
  const gameId = payload.slice(0, sep);
  const roleId = payload.slice(sep + 1);
  if (!gameId || !roleId) return null;
  return { gameId, roleId };
}

export function parseBuffetMulliganCustomId(customId: string): { gameId: string } | null {
  if (!customId.startsWith(BUFFET_MULLIGAN_PREFIX)) return null;
  const gameId = customId.slice(BUFFET_MULLIGAN_PREFIX.length).trim();
  if (!gameId) return null;
  return { gameId };
}

export function isBuffetInteraction(customId: string): boolean {
  return (
    customId.startsWith(BUFFET_PICK_PREFIX) || customId.startsWith(BUFFET_MULLIGAN_PREFIX)
  );
}

export function buildBuffetOfferMessage(
  roleIds: string[],
  gameId: string,
  mulliganStep: number,
  mulliganStepsCount: number,
  options?: { drafterName?: string; forStoryteller?: boolean },
): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const hasMoreMulligans = mulliganStep + 1 < mulliganStepsCount;

  const roleButtons = roleIds.map((roleId) => {
    const role = catalog.get(roleId);
    return new ButtonBuilder()
      .setCustomId(buffetPickCustomId(gameId, roleId))
      .setLabel(role?.name ?? roleId)
      .setStyle(ButtonStyle.Primary);
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < roleButtons.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(roleButtons.slice(i, i + 5)),
    );
  }

  if (hasMoreMulligans) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buffetMulliganCustomId(gameId))
          .setLabel("Mulligan (fewer choices)")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  const intro =
    options?.forStoryteller && options.drafterName
      ? `**Sushi Buffet — pick for ${options.drafterName}** (bot)\nChoose a role for this player using the buttons below.`
      : "**Sushi Buffet — choose your role!**\nPick one of the options below.";
  const mulliganNote = hasMoreMulligans
    ? " You can also mulligan for fewer choices."
    : " No mulligans remaining.";

  return { content: `${intro}${mulliganNote}`, components: rows };
}

async function disableOfferButtons(interaction: ButtonInteraction): Promise<void> {
  try {
    await interaction.message.edit({ components: [] });
  } catch {
    // best effort
  }
}

function roleDisplayName(roleId: string): string {
  return listBotcRoles().find((r) => r.id === roleId)?.name ?? roleId;
}

async function revealRoleForDrafter(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null },
  drafter: { id: string; discordUserId: string; displayName: string; isFake: boolean },
  roleId: string,
): Promise<void> {
  const roleEmbed = buildRoleDmEmbed(roleId);
  if (drafter.isFake) {
    const kib = await resolveBuffetOfferChannel(guild, game);
    if (kib) {
      await kib.send({
        content: `**${drafter.displayName}** → **${roleDisplayName(roleId)}**`,
        embeds: [roleEmbed],
      });
    }
    return;
  }

  const playerRow = await prisma.player.findFirst({
    where: { gameId: game.id, discordUserId: drafter.discordUserId },
    select: { stThreadId: true },
  });
  if (!playerRow?.stThreadId) return;
  const thread = await guild.channels.fetch(playerRow.stThreadId).catch(() => null);
  if (thread?.isThread()) {
    await thread.send({ content: "**Your role:**", embeds: [roleEmbed] });
  }
}

async function resolveBuffetOfferChannel(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null },
): Promise<SendableChannels | null> {
  const kib = await getKibThreadForGame(guild, game);
  if (kib?.isSendable()) return kib;
  const channel = await guild.channels.fetch(game.channelId).catch(() => null);
  if (channel?.isSendable()) return channel;
  return null;
}

/** Post the current buffet offer to the drafter's ST thread or kib (for bots). */
export async function postBuffetOffer(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null },
  engine: GameEngine,
  offer: { playerId: string; roleIds: string[]; mulliganStep: number },
): Promise<void> {
  const player = engine.getState().players.find((p) => p.id === offer.playerId);
  if (!player) return;
  const draft = engine.getState().buffetDraft;
  if (!draft) return;

  const { content, components } = buildBuffetOfferMessage(
    offer.roleIds,
    game.id,
    offer.mulliganStep,
    draft.config.mulliganSteps.length,
    player.isFake ? { drafterName: player.displayName, forStoryteller: true } : undefined,
  );

  if (player.isFake) {
    const channel = await resolveBuffetOfferChannel(guild, game);
    if (channel) {
      await channel.send({ content, components });
    }
    return;
  }

  const playerRow = await prisma.player.findFirst({
    where: { gameId: game.id, discordUserId: player.discordUserId },
    select: { stThreadId: true },
  });
  if (!playerRow?.stThreadId) return;
  const thread = await guild.channels.fetch(playerRow.stThreadId).catch(() => null);
  if (!thread?.isThread()) return;
  await thread.send({ content, components });
}

async function finishBuffetPick(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null },
  engine: GameEngine,
  drafter: { id: string; discordUserId: string; displayName: string; isFake: boolean },
  roleId: string,
): Promise<"complete" | "continued"> {
  const draft = engine.getState().buffetDraft;
  if (draft?.status === "complete") {
    await upsertPinnedGameStatus(guild, game.channelId, engine);
    await postGameLog(
      guild,
      game,
      "Sushi Buffet draft complete — all players have picked their roles.",
    );
    return "complete";
  }

  const nextOffer = draft?.currentOffer;
  if (nextOffer) {
    await postBuffetOffer(guild, game, engine, nextOffer);
  }
  await upsertPinnedGameStatus(guild, game.channelId, engine);
  void drafter;
  void roleId;
  return "continued";
}

export async function handleBuffetPick(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseBuffetPickCustomId(interaction.customId);
  if (!parsed) return false;

  const { gameId, roleId } = parsed;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const game = await getGameById(gameId);
  if (!game || game.phase === "ended") {
    await interaction.editReply({ content: "No active game found for this draft." });
    return true;
  }

  const engine = await loadEngine(gameId);
  const draft = engine.getState().buffetDraft;

  if (!draft || draft.status !== "active") {
    await interaction.editReply({ content: "No active buffet draft." });
    return true;
  }

  const offer = draft.currentOffer;
  if (!offer) {
    await interaction.editReply({ content: "No current offer to pick from." });
    return true;
  }

  const drafter = engine.getState().players.find((p) => p.id === offer.playerId);
  if (!drafter) {
    await interaction.editReply({ content: "Current drafter not found." });
    return true;
  }

  if (drafter.isFake) {
    if (!(await canActAsStoryteller(interaction, game, engine))) {
      await interaction.editReply({
        content: "Only the storyteller can pick roles for bot players.",
      });
      return true;
    }
  } else {
    const clicker = engine.getState().players.find(
      (p) => p.discordUserId === interaction.user.id,
    );
    if (!clicker || clicker.id !== offer.playerId) {
      await interaction.editReply({ content: "It is not your turn to pick." });
      return true;
    }
  }

  if (!offer.roleIds.includes(roleId)) {
    await interaction.editReply({ content: "That role was not in the offer." });
    return true;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: "This must be used in a server." });
    return true;
  }

  try {
    const events = engine.handle({
      kind: GameCommandKind.PickBuffetRole,
      gameId,
      playerId: drafter.id,
      roleId,
    });
    await persistEvents(engine, events);
    await disableOfferButtons(interaction);
    await revealRoleForDrafter(guild, game, drafter, roleId);

    const roleName = roleDisplayName(roleId);
    const outcome = await finishBuffetPick(guild, game, engine, drafter, roleId);

    if (outcome === "complete") {
      await interaction.editReply({
        content: drafter.isFake
          ? `Assigned **${roleName}** to **${drafter.displayName}**. Draft complete!`
          : `You picked **${roleName}**. The draft is complete!`,
      });
    } else {
      await interaction.editReply({
        content: drafter.isFake
          ? `Assigned **${roleName}** to **${drafter.displayName}**.`
          : `You picked **${roleName}**!`,
      });
    }
  } catch (error) {
    await replyEngineError(interaction, error);
  }

  return true;
}

export async function handleBuffetMulligan(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseBuffetMulliganCustomId(interaction.customId);
  if (!parsed) return false;

  const { gameId } = parsed;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const game = await getGameById(gameId);
  if (!game || game.phase === "ended") {
    await interaction.editReply({ content: "No active game found for this draft." });
    return true;
  }

  const engine = await loadEngine(gameId);
  const draft = engine.getState().buffetDraft;

  if (!draft || draft.status !== "active") {
    await interaction.editReply({ content: "No active buffet draft." });
    return true;
  }

  const offer = draft.currentOffer;
  if (!offer) {
    await interaction.editReply({ content: "No current offer to mulligan." });
    return true;
  }

  const drafter = engine.getState().players.find((p) => p.id === offer.playerId);
  if (!drafter) {
    await interaction.editReply({ content: "Current drafter not found." });
    return true;
  }

  if (drafter.isFake) {
    if (!(await canActAsStoryteller(interaction, game, engine))) {
      await interaction.editReply({
        content: "Only the storyteller can mulligan for bot players.",
      });
      return true;
    }
  } else {
    const clicker = engine.getState().players.find(
      (p) => p.discordUserId === interaction.user.id,
    );
    if (!clicker || clicker.id !== offer.playerId) {
      await interaction.editReply({ content: "It is not your turn." });
      return true;
    }
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: "This must be used in a server." });
    return true;
  }

  try {
    const events = engine.handle({
      kind: GameCommandKind.MulliganBuffet,
      gameId,
      playerId: drafter.id,
    });
    await persistEvents(engine, events);
    await disableOfferButtons(interaction);

    const newOffer = engine.getState().buffetDraft?.currentOffer;
    if (newOffer) {
      await postBuffetOffer(guild, game, engine, newOffer);
    }

    await syncGameProjection(gameId, engine);
    await interaction.editReply({
      content: drafter.isFake
        ? `Mulligan for **${drafter.displayName}** — new choices posted in kib.`
        : "Mulligan used — new choices posted in your ST thread.",
    });
  } catch (error) {
    await replyEngineError(interaction, error);
  }

  return true;
}

/** @deprecated Use postBuffetOffer */
export const postOfferToPlayerThread = postBuffetOffer;

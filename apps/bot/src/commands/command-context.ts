import {
  AnyThreadChannel,
  CommandInteraction,
  EmbedBuilder,
  Guild,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  Role,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  appendGameEvent,
  getActiveGameForGuild,
  getGameEvents,
  prisma,
  type Prisma,
} from "@grimkeeper/database";
import {
  DEV_MIN_PLAYERS,
  DEFAULT_MIN_PLAYERS,
  GameEngine,
  GameEngineError,
  StandardEdition,
  findScriptRole,
  getScriptCompositionText,
  isFakePlayer,
  parseScriptJson,
  resolveStandardScript,
  type GameEvent,
  type GameScript,
} from "@grimkeeper/engine";

import { canUseBot } from "../access.js";
import { isDevMode } from "../dev.js";
import { logError } from "../logger.js";
import { logGameEvent } from "../game-events-log.js";
import { buildRoleDmEmbed } from "../role-embed.js";

export const GAME_DISCORD_ROLES_ENABLED = false;
export const STORYTELLER_THREAD_NAME = "ST and the gang";

export function minPlayers(): number {
  return isDevMode() ? DEV_MIN_PLAYERS : DEFAULT_MIN_PLAYERS;
}

export async function loadScriptForCreate(
  edition: string | undefined,
  scriptUrl: string | undefined,
): Promise<GameScript> {
  if (scriptUrl?.trim()) {
    const response = await fetch(scriptUrl.trim());
    if (!response.ok) {
      throw new Error(`Could not fetch script JSON (HTTP ${response.status}).`);
    }
    const json: unknown = await response.json();
    return parseScriptJson(json, { source: "custom", scriptUrl: scriptUrl.trim() });
  }

  return resolveStandardScript(parseEdition(edition));
}

export function parseEdition(value: string | undefined): StandardEdition {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "tb" || normalized === "trouble brewing") {
    return StandardEdition.TB;
  }
  if (normalized === "bmr" || normalized === "bad moon rising") {
    return StandardEdition.BMR;
  }
  if (
    normalized === "snv" ||
    normalized === "sects & violets" ||
    normalized === "sects and violets"
  ) {
    return StandardEdition.SNV;
  }
  throw new Error("Edition must be TB, BMR, or SNV.");
}

export async function deliverRolesToPlayers(
  interaction: CommandInteraction,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<string[]> {
  const script = engine.getState().script;
  const roleLines: string[] = [];

  for (const player of engine.getState().players) {
    const roleId = player.roleId ?? "unknown";
    const roleName = script ? (findScriptRole(script, roleId)?.name ?? roleId) : roleId;
    if (isFakePlayer(player.discordUserId) || isDevMode()) {
      roleLines.push(`${player.displayName}: **${roleName}**${player.isFake ? " (fake)" : ""}`);
      continue;
    }

    const playerThread = await getOrCreatePersonalPlayerThread(
      interaction,
      game.id,
      game.channelId,
      player.discordUserId,
      player.displayName,
    );
    if (playerThread) {
      await playerThread
        .send({
          content: `Your role is ready, <@${player.discordUserId}>.`,
          embeds: [buildRoleDmEmbed(roleId, script)],
        })
        .catch(() => undefined);
      continue;
    }

    const member = await interaction.guild?.members.fetch(player.discordUserId).catch(() => null);
    if (!member) continue;
    await member.send({ embeds: [buildRoleDmEmbed(roleId, script)] }).catch(() => undefined);
  }

  return roleLines;
}

export async function loadEngine(gameId: string): Promise<GameEngine> {
  const stored = await getGameEvents(gameId);
  const events = stored.map((event) => event.payload as unknown as GameEvent);
  return GameEngine.fromEvents(gameId, events);
}

export function toJson(event: GameEvent): Prisma.InputJsonValue {
  return structuredClone(event) as unknown as Prisma.InputJsonValue;
}

export async function persistEvents(engine: GameEngine, events: ReturnType<GameEngine["handle"]>): Promise<void> {
  for (const event of events) {
    engine.apply(event);
    await appendGameEvent(engine.getState().gameId, event.type, toJson(event));
    logGameEvent(engine, event);
  }
}

export async function syncGameProjection(gameId: string, engine: GameEngine): Promise<void> {
  const state = engine.getState();
  await prisma.game.update({
    where: { id: gameId },
    data: { phase: state.phase },
  });

  for (const player of state.players) {
    await prisma.player.updateMany({
      where: { id: player.id, gameId },
      data: {
        seat: player.seat,
        roleId: player.roleId,
        alive: player.alive,
      },
    });
  }
}

export async function requireStorytellerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game) {
    await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const engine = await loadEngine(game.id);
  if (!engine.isStoryteller(interaction.user.id)) {
    await interaction.reply({ content: "Only storytellers can run this command.", flags: MessageFlags.Ephemeral });
    return null;
  }

  return game;
}

export async function requireActivePlayerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (!game) {
    await interaction.reply({ content: "No active game found.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const engine = await loadEngine(game.id);
  const player = engine.getPlayerByDiscordId(interaction.user.id);
  if (!player) {
    await interaction.reply({ content: "You are not in this game.", flags: MessageFlags.Ephemeral });
    return null;
  }

  return { game, engine, player };
}

export async function requireCommandAccess(interaction: CommandInteraction): Promise<boolean> {
  const allowed = await canUseBot(interaction);
  if (allowed) return true;

  const message =
    "You are not allowed to use this bot. Ask an admin to add your user ID " +
    "to `ALLOWED_USER_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
  return false;
}

type GameRoles = {
  stRole: Role;
  playersRole: Role;
};

export function roleSlugFromChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "game";
}

export async function ensureGameRoles(guild: Guild | null, channelId: string): Promise<GameRoles | null> {
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const slug = roleSlugFromChannelName(channel.name);
  const stName = `st-${slug}`;
  const playersName = `p-${slug}`;

  const existing = await getGameRolesByName(guild, stName, playersName);
  if (existing) return existing;

  try {
    const stRole = await guild.roles.create({ name: stName, mentionable: true });
    const playersRole = await guild.roles.create({ name: playersName, mentionable: true });
    return { stRole, playersRole };
  } catch {
    return null;
  }
}

export async function getGameRoles(guild: Guild | null, channelId: string): Promise<GameRoles | null> {
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const slug = roleSlugFromChannelName(channel.name);
  return getGameRolesByName(guild, `st-${slug}`, `p-${slug}`);
}

export async function getGameRolesByName(
  guild: Guild,
  stName: string,
  playersName: string,
): Promise<GameRoles | null> {
  await guild.roles.fetch();
  const stRole = guild.roles.cache.find((role) => role.name === stName);
  const playersRole = guild.roles.cache.find((role) => role.name === playersName);
  if (!stRole || !playersRole) return null;
  return { stRole, playersRole };
}

export async function addRoleToUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await member.roles.add(roleId).catch(() => undefined);
}

export async function removeRoleFromUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await member.roles.remove(roleId).catch(() => undefined);
}

export async function cleanupGameRoles(guild: Guild | null, channelId: string): Promise<void> {
  if (!guild) return;
  const roles = await getGameRoles(guild, channelId);
  if (!roles) return;

  // Deleting a role removes it from all members automatically.
  await roles.playersRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
  await roles.stRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
}

export async function postToTownChannel(
  guild: Guild,
  channelId: string,
  payload: { content?: string; embeds?: EmbedBuilder[] },
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(payload).catch(() => undefined);
}

export async function postToStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  payload: { content?: string; embeds?: EmbedBuilder[] },
): Promise<void> {
  const thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread) return;
  await thread.send(payload).catch(() => undefined);
}

export async function postSetupChecklist(
  stThread: AnyThreadChannel,
  playerCount: number,
): Promise<void> {
  await stThread
    .send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Setup checklist")
          .setDescription(
            [
              `1. \`/st open-seats\` — players pick seats 1–${playerCount} (announced in town)`,
              "2. `/st close-seats` — lock seating and post the chart in town",
              "3. `/st grim-setup` — review script and composition",
              "4. `/st deal` or `/st assign` + `/st begin-night` — grimoire and night 1",
            ].join("\n"),
          ),
      ],
    })
    .catch(() => undefined);
}

export async function ensureGameThreads(
  interaction: CommandInteraction,
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<{
  stThread: AnyThreadChannel | null;
  playerThreadsCreated: number;
  playerThreadsFailed: number;
}> {
  const stThread = await ensureStorytellerThread(
    guild,
    game.channelId,
    game.id,
    engine.getStorytellerDiscordIds(),
  );

  let playerThreadsCreated = 0;
  let playerThreadsFailed = 0;
  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId)) continue;
    const thread = await getOrCreatePersonalPlayerThread(
      interaction,
      game.id,
      game.channelId,
      player.discordUserId,
      player.displayName,
    );
    if (thread) playerThreadsCreated++;
    else playerThreadsFailed++;
  }

  return { stThread, playerThreadsCreated, playerThreadsFailed };
}

export function personalPlayerThreadName(gameId: string, displayName: string): string {
  const sanitized = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const shortGameId = gameId.slice(0, 6);
  return `player-${sanitized || "member"}-${shortGameId}`.slice(0, 100);
}

export function isGameTextChannel(
  channel: { type: ChannelType } | null,
): channel is { type: ChannelType.GuildText | ChannelType.GuildAnnouncement; threads: { create: (...args: never[]) => Promise<AnyThreadChannel> } } {
  return (
    channel !== null &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
  );
}

export async function findPersonalPlayerThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  displayName: string,
): Promise<AnyThreadChannel | null> {
  const threadName = personalPlayerThreadName(gameId, displayName);
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) => candidate.parentId === parentChannelId && candidate.name === threadName,
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => candidate.name === threadName) ?? null;
}

export async function ensureStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  storytellerDiscordIds: string[],
): Promise<AnyThreadChannel | null> {
  let thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread) {
    const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
    if (!isGameTextChannel(parent)) return null;

    try {
      thread = await parent.threads.create({
        name: STORYTELLER_THREAD_NAME,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `Storyteller thread for game ${gameId}`,
        ...( {
          type: ChannelType.PrivateThread,
          invitable: false,
        } as Record<string, unknown>),
      });
      await thread
        .send(
          "Storyteller thread ready. Use this space for private narration and spectator discussion.",
        )
        .catch(() => undefined);
    } catch {
      return null;
    }
  }

  if (thread.archived) {
    await thread.setArchived(false, "Game started; reopening storyteller thread.").catch(() => undefined);
  }

  for (const discordUserId of storytellerDiscordIds) {
    await thread.members.add(discordUserId).catch(() => undefined);
  }

  return thread;
}

export async function getOrCreatePersonalPlayerThread(
  interaction: CommandInteraction,
  gameId: string,
  parentChannelId: string,
  userId: string,
  displayName: string,
): Promise<AnyThreadChannel | null> {
  const guild = interaction.guild;
  if (!guild) return null;

  const existing = await findPersonalPlayerThread(guild, parentChannelId, gameId, displayName);
  if (existing) {
    if (existing.archived) {
      await existing.setArchived(false, "Game in progress; reopening player thread.").catch(() => undefined);
    }
    await existing.members.add(userId).catch(() => undefined);
    return existing;
  }

  return createPersonalPlayerThread(interaction, gameId, parentChannelId, userId, displayName);
}
export async function createStorytellerThread(
  interaction: CommandInteraction,
  gameId: string,
): Promise<string | null> {
  const guild = interaction.guild;
  const channelId = interaction.channelId;
  if (!guild || !channelId) return null;

  const thread = await ensureStorytellerThread(guild, channelId, gameId, [interaction.user.id]);
  return thread ? `<#${thread.id}>` : null;
}

export async function createPersonalPlayerThread(
  interaction: CommandInteraction,
  gameId: string,
  parentChannelId: string,
  userId: string,
  displayName: string,
): Promise<AnyThreadChannel | null> {
  const guild = interaction.guild;
  if (!guild) return null;
  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (
    !parent ||
    (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement)
  ) {
    return null;
  }

  const threadName = personalPlayerThreadName(gameId, displayName);

  try {
    const thread = await parent.threads.create({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Private player thread for ${displayName} in game ${gameId}`,
      ...( {
        type: ChannelType.PrivateThread,
        invitable: false,
      } as Record<string, unknown>),
    });

    await thread.members.add(userId).catch(() => undefined);
    await thread.send(
      `Hi <@${userId}>! This is your private game thread for Grimkeeper.`,
    );
    return thread;
  } catch {
    return null;
  }
}

export function isStorytellerThread(candidate: AnyThreadChannel, parentChannelId: string): boolean {
  return candidate.parentId === parentChannelId && candidate.name === STORYTELLER_THREAD_NAME;
}

export async function getStorytellerThread(
  guild: Guild,
  parentChannelId: string,
): Promise<AnyThreadChannel | null> {
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find((candidate) =>
    isStorytellerThread(candidate, parentChannelId),
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (
    !parent ||
    (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement)
  ) {
    return null;
  }

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => isStorytellerThread(candidate, parentChannelId)) ?? null;
}

export async function openStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  extraMemberIds: Iterable<string>,
): Promise<AnyThreadChannel | null> {
  const thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread) return null;

  await thread
    .edit({
      archived: false,
      locked: false,
      invitable: true,
      reason: "Game ended; opening storyteller thread for post-game discussion.",
    })
    .catch(() => undefined);

  for (const userId of extraMemberIds) {
    await thread.members.add(userId).catch(() => undefined);
  }

  await thread
    .send("Game ended — this thread is now open for post-game discussion.")
    .catch(() => undefined);
  return thread;
}

export async function replyEngineError(interaction: CommandInteraction, error: unknown): Promise<void> {
  const message = error instanceof GameEngineError ? error.message : "Unexpected game engine error.";
  if (!(error instanceof GameEngineError)) {
    logError("error", "command.failed", error, {
      command: interaction.commandName,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });
  }
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

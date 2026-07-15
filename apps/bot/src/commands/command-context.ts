import {
  AnyThreadChannel,
  CommandInteraction,
  EmbedBuilder,
  Guild,
  ChannelType,
  MessageFlags,
  Role,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  appendGameEvent,
  getActiveGameForGuild,
  getGameEvents,
  prisma,
  syncGameProjectionFromEngine,
  type Prisma,
} from "@grimkeeper/database";
import type { ReminderScope } from "@grimkeeper/database";
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
  type NominationRecord,
  type PlayerState,
} from "@grimkeeper/engine";

import { canUseBot, canManageChannelReminders, getAdminRoleIds, getReminderPingRoleId, isInExplicitAllowlist } from "../access.js";
import { isMinimalMode } from "../bot-mode.js";
import { isDevMode } from "../dev.js";
import {
  dayThreadName,
  townVoteThreadName,
  postNominationToChannel,
  updateNominationMessagesInChannels,
  addDayThreadMembers,
  type DayDiscussionChannel,
} from "../day-thread.js";
import { getBotClient } from "../discord-client.js";
import { buildReminderFireContent } from "../reminder-message.js";
import { reportError } from "../error-reporter.js";
import { isInteractionAlreadyAcknowledged, withAcknowledgedFallback } from "../interactions/interaction-response.js";
import { logGameEvent } from "../game-events-log.js";
import { refreshGameStatusForEngine } from "../game-status.js";
import { buildRoleDmEmbed } from "../role-embed.js";

export const GAME_DISCORD_ROLES_ENABLED = true;
export const STORYTELLER_THREAD_NAME = "ST and the gang";

export function kibThreadName(parentChannelName: string): string {
  return `kib-${parentChannelName}`.slice(0, 100);
}

export function stPlayerThreadName(displayName: string): string {
  return `ST ${displayName}`.slice(0, 100);
}

export function storytellerThreadName(parentChannelName?: string): string {
  if (isMinimalMode() && parentChannelName) {
    return kibThreadName(parentChannelName);
  }
  return STORYTELLER_THREAD_NAME;
}

export function minPlayers(): number {
  return isDevMode() ? DEV_MIN_PLAYERS : DEFAULT_MIN_PLAYERS;
}

export function resolvePlayerRef(
  engine: GameEngine,
  options: { userId?: string; seat?: number | null },
): PlayerState | undefined {
  if (options.userId) {
    return engine.getPlayerByDiscordId(options.userId);
  }
  if (options.seat != null) {
    return engine.getState().players.find((player) => player.seat === options.seat);
  }
  return undefined;
}

export function findOpenNominationForNominee(
  engine: GameEngine,
  nomineeId: string,
): NominationRecord | undefined {
  return engine
    .getState()
    .day?.nominations.find(
      (nomination) => nomination.nomineeId === nomineeId && nomination.status === "open",
    );
}

export function formatDayStatus(engine: GameEngine): string {
  const state = engine.getState();
  const day = state.day;
  if (state.phase !== "day" || !day) {
    return `Phase: **${state.phase}** (no active day)`;
  }

  const lines = [
    `Day **${state.dayNumber}** — nominations ${day.nominationsOpen ? "open" : "closed"}`,
    `Vote visibility: **${day.voteVisibility}**`,
    `Execution used: **${day.executionUsed ? "yes" : "no"}**`,
    `Day thread: ${day.discordThreadId ? `<#${day.discordThreadId}>` : "not set"}`,
  ];

  if (day.nominations.length === 0) {
    lines.push("", "No nominations.");
    return lines.join("\n");
  }

  lines.push("", "**Nominations:**");
  for (const nomination of day.nominations.slice().sort((a, b) => a.order - b.order)) {
    const nominator = engine.getPlayerById(nomination.nominatorId);
    const nominee = engine.getPlayerById(nomination.nomineeId);
    const tally = engine.formatNominationTally(nomination.id, { revealSecret: true });
    lines.push(
      `#${nomination.order} ${nominator?.displayName ?? "?"} → ${nominee?.displayName ?? "?"} [${nomination.status}] — ${tally}`,
    );
    const votes = day.votes
      .filter((vote) => vote.nominationId === nomination.id)
      .map((vote) => {
        const voter = engine.getPlayerById(vote.voterId);
        const suffix = vote.reason ? ` (${vote.reason})` : "";
        return `  - ${voter?.displayName ?? "?"}: ${vote.choice}${suffix}`;
      });
    lines.push(...votes);
  }

  return lines.join("\n");
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

  if (events.length > 0) {
    await syncGameProjection(engine.getState().gameId, engine);
    await refreshGameStatusForEngine(engine);
  }
}

export async function syncGameProjection(gameId: string, engine: GameEngine): Promise<void> {
  await syncGameProjectionFromEngine(gameId, engine);
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

export async function requireSetRemindersAccess(interaction: CommandInteraction) {
  return requireReminderAccess(interaction);
}

export type ReminderAccess = {
  scope: ReminderScope;
  targetChannelId: string;
  game: Awaited<ReturnType<typeof getActiveGameForGuild>>;
  engine: GameEngine | null;
};

export async function resolveReminderTargetChannel(
  interaction: CommandInteraction,
): Promise<string | null> {
  if (!interaction.channelId) return null;

  const cached = interaction.channel;
  if (cached?.isThread()) {
    return cached.parentId ?? interaction.channelId;
  }
  if (cached) {
    return interaction.channelId;
  }

  if (interaction.inGuild()) {
    const fetched = await interaction.guild!.channels.fetch(interaction.channelId).catch(() => null);
    if (fetched?.isThread()) {
      return fetched.parentId ?? interaction.channelId;
    }
  }

  return interaction.channelId;
}

export function buildGameReminderChannelIds(
  game: { channelId: string },
  targetChannelId: string,
  engine: GameEngine | null,
): string[] {
  const channelIds = new Set([targetChannelId, game.channelId]);
  const dayThreadId = engine?.getState().day?.discordThreadId;
  if (dayThreadId) channelIds.add(dayThreadId);
  return [...channelIds];
}

export async function requireReminderAccess(interaction: CommandInteraction): Promise<ReminderAccess | null> {
  if (!interaction.guildId) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const targetChannelId = await resolveReminderTargetChannel(interaction);
  if (!targetChannelId) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a channel or thread.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const game = await getActiveGameForGuild(interaction.guildId);
  if (game) {
    const engine = await loadEngine(game.id);
    const isStoryteller = engine.isStoryteller(interaction.user.id);
    const isAllowlistOverride = await isInExplicitAllowlist(interaction);

    if (isStoryteller || isAllowlistOverride) {
      const channelIds = buildGameReminderChannelIds(game, targetChannelId, engine);
      return {
        scope: {
          kind: "game",
          gameId: game.id,
          guildId: interaction.guildId,
          channelId: targetChannelId,
          channelIds,
        },
        targetChannelId,
        game,
        engine,
      };
    }
  }

  if (!(await canManageChannelReminders(interaction))) {
    await replyOrEditInteraction(interaction, {
      content:
        "No active game access. Set channel reminders with `REMINDER_ROLE_IDS`, or add your user/role to `ALLOWED_USER_IDS` / `ALLOWED_ROLE_IDS`.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return {
    scope: { kind: "channel", guildId: interaction.guildId, channelId: targetChannelId },
    targetChannelId,
    game: null,
    engine: null,
  };
}

export async function buildReminderPingMention(
  reminder: { gameId: string | null; guildId: string; pingPlayers: boolean; pingRoleId?: string | null },
): Promise<string | null> {
  if (!reminder.pingPlayers) return null;

  if (reminder.pingRoleId) {
    const mentions = reminder.pingRoleId
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => `<@&${id}>`)
      .join(" ");
    return mentions || null;
  }

  if (reminder.gameId) {
    return buildPlayerPingMention(reminder.gameId, reminder.guildId);
  }

  const pingRoleId = getReminderPingRoleId();
  return pingRoleId ? `<@&${pingRoleId}>` : null;
}

export async function buildPlayerPingMention(
  gameId: string,
  guildId: string,
): Promise<string | null> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return null;

  const client = getBotClient();
  const discordGuild = (await client?.guilds.fetch(guildId).catch(() => null)) ?? null;
  const gameRoles = await getGameRoles(discordGuild, game.channelId);
  if (gameRoles) {
    return `<@&${gameRoles.playersRole.id}>`;
  }

  if (!GAME_DISCORD_ROLES_ENABLED) {
    const engine = await loadEngine(gameId);
    const mentions = engine
      .getState()
      .players.filter((player) => !player.isFake)
      .map((player) => `<@${player.discordUserId}>`)
      .join(" ");
    return mentions || null;
  }

  return null;
}

export { buildReminderFireContent };

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
  spectatorRole: Role;
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
  if (!channel || !("name" in channel)) return null;
  const slug = roleSlugFromChannelName(channel.name);
  const stName = `st-${slug}`;
  const playersName = `p-${slug}`;
  const spectatorName = `spec-${slug}`;

  const existing = await getGameRolesByName(guild, stName, playersName, spectatorName);
  if (existing) return existing;

  try {
    const stRole = await guild.roles.create({ name: stName, mentionable: true });
    const playersRole = await guild.roles.create({ name: playersName, mentionable: true });
    const spectatorRole = await guild.roles.create({ name: spectatorName, mentionable: false });
    return { stRole, playersRole, spectatorRole };
  } catch {
    return null;
  }
}

export async function getGameRoles(guild: Guild | null, channelId: string): Promise<GameRoles | null> {
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const slug = roleSlugFromChannelName(channel.name);
  return getGameRolesByName(guild, `st-${slug}`, `p-${slug}`, `spec-${slug}`);
}

export async function getGameRolesByName(
  guild: Guild,
  stName: string,
  playersName: string,
  spectatorName: string,
): Promise<GameRoles | null> {
  await guild.roles.fetch();
  const stRole = guild.roles.cache.find((role) => role.name === stName);
  const playersRole = guild.roles.cache.find((role) => role.name === playersName);
  if (!stRole || !playersRole) return null;

  let spectatorRole = guild.roles.cache.find((role) => role.name === spectatorName);
  if (!spectatorRole) {
    try {
      spectatorRole = await guild.roles.create({ name: spectatorName, mentionable: false });
    } catch {
      return null;
    }
  }

  return { stRole, playersRole, spectatorRole };
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
  await roles.spectatorRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
  await roles.playersRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
  await roles.stRole.delete("Grimkeeper game ended; cleanup game roles.").catch(() => undefined);
}

export async function applyGameChannelPermissions(
  guild: Guild,
  channelId: string,
  stRoleId: string,
  playersRoleId: string,
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !("permissionOverwrites" in channel)) return;

  // ST (+ admins): full thread control so they can join private player threads and invite helpers.
  const stThreadPermissions = {
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
    ManageThreads: true,
  };
  // Players must NOT have ManageThreads — with it, Discord lets them invite others into
  // private threads even when invitable is false.
  const playerThreadPermissions = {
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: true,
    ManageThreads: false,
  };

  await channel.permissionOverwrites.edit(stRoleId, stThreadPermissions).catch(() => undefined);
  await channel.permissionOverwrites.edit(playersRoleId, playerThreadPermissions).catch(() => undefined);

  for (const adminRoleId of getAdminRoleIds()) {
    await channel.permissionOverwrites
      .edit(adminRoleId, stThreadPermissions)
      .catch(() => undefined);
  }
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
  const stThread = await ensureStorytellerThread(guild, game.channelId, game.id);

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
  const shortGameId = gameId.slice(0, 6);
  if (isMinimalMode()) {
    // Include game id so successive games in the same channel do not reuse stale threads.
    return `ST ${displayName} · ${shortGameId}`.slice(0, 100);
  }
  const sanitized = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

export async function createKibThread(
  interaction: CommandInteraction,
  gameId: string,
  gameRoles?: GameRoles,
): Promise<string | null> {
  const guild = interaction.guild;
  const channelId = interaction.channelId;
  if (!guild || !channelId) return null;

  const parent = await guild.channels.fetch(channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const threadName = kibThreadName(parent.name);
  let thread = await getStorytellerThread(guild, channelId);
  if (!thread) {
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `Kib thread for game ${gameId}`,
        ...( {
          type: ChannelType.PrivateThread,
          invitable: true,
        } as Record<string, unknown>),
      });
      const roleMention = gameRoles
        ? ` Pingable roles: <@&${gameRoles.stRole.id}> / <@&${gameRoles.playersRole.id}>.`
        : "";
      await thread
        .send(`Kib thread ready.${roleMention} Use \`/st add-spectator\` to assign spectators.`)
        .catch(() => undefined);
    } catch {
      return null;
    }
  }

  if (thread.archived) {
    await thread.setArchived(false, "Game created; reopening kib thread.").catch(() => undefined);
  }

  await thread.members.add(interaction.user.id).catch(() => undefined);
  return `<#${thread.id}>`;
}

export async function createPlayerStThreads(
  interaction: CommandInteraction,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<{ created: number; failed: number }> {
  const guild = interaction.guild;
  if (!guild) return { created: 0, failed: 0 };

  const storytellerIds = engine.getStorytellerDiscordIds();
  let created = 0;
  let failed = 0;

  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId)) continue;

    const thread =
      (await findPersonalPlayerThread(guild, game.channelId, game.id, player.displayName)) ??
      (await createPersonalPlayerThread(
        interaction,
        game.id,
        game.channelId,
        player.discordUserId,
        player.displayName,
      ));

    if (!thread) {
      failed++;
      continue;
    }

    if (thread.archived) {
      await thread.setArchived(false, "Game started; reopening player thread.").catch(() => undefined);
    }

    await thread.members.add(player.discordUserId).catch(() => undefined);
    for (const stId of storytellerIds) {
      await thread.members.add(stId).catch(() => undefined);
    }

    if (isMinimalMode()) {
      await thread
        .send({
          content: `Private ST thread for <@${player.discordUserId}>. Only you, the storyteller, and server admins can access this thread.`,
          allowedMentions: { users: [player.discordUserId] },
        })
        .catch(() => undefined);
    }

    created++;
  }

  return { created, failed };
}

export async function ensureStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
): Promise<AnyThreadChannel | null> {
  let thread = await getStorytellerThread(guild, parentChannelId);
  if (!thread) {
    const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
    if (!isGameTextChannel(parent)) return null;

    const threadName = storytellerThreadName(parent.name);

    try {
      thread = await parent.threads.create({
        name: threadName,
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

  const thread = await ensureStorytellerThread(guild, channelId, gameId);
  if (thread) {
    await thread.members.add(interaction.user.id).catch(() => undefined);
  }
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
    await thread.send({
      content: `Hi <@${userId}>! This is your private game thread for Grimkeeper.\nOnly you, the storyteller, and server admins can see this thread — do not try to invite others.`,
      allowedMentions: { users: [userId] },
    });
    return thread;
  } catch {
    return null;
  }
}

export function isStorytellerThread(
  candidate: { parentId: string | null; name: string },
  parentChannelId: string,
  parentChannelName?: string,
): boolean {
  if (candidate.parentId !== parentChannelId) return false;
  const expectedName = storytellerThreadName(parentChannelName);
  return candidate.name === expectedName;
}

export async function getStorytellerThread(
  guild: Guild,
  parentChannelId: string,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  const parentChannelName = parent && "name" in parent ? parent.name : undefined;
  const expectedName = storytellerThreadName(parentChannelName);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) =>
      candidate.parentId === parentChannelId && candidate.name === expectedName,
  );
  if (activeThread) return activeThread;

  if (!isGameTextChannel(parent)) return null;

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => candidate.name === expectedName) ?? null;
}

export async function openStorytellerThread(
  guild: Guild,
  parentChannelId: string,
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

  await thread
    .send("Game ended — this thread is now open for post-game discussion.")
    .catch(() => undefined);
  return thread;
}

export async function resolveVotingChannel(
  guild: Guild,
  game: { channelId: string },
  engine: GameEngine,
): Promise<DayDiscussionChannel | null> {
  const state = engine.getState();
  const dayThreadId = state.day?.discordThreadId;

  if (dayThreadId) {
    const thread = await guild.channels.fetch(dayThreadId).catch(() => null);
    if (thread?.isThread()) {
      return thread as DayDiscussionChannel;
    }
  }

  if (state.townMode) {
    const channel = await guild.channels.fetch(game.channelId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      return channel as DayDiscussionChannel;
    }
    return null;
  }

  return null;
}

export async function listPersonalPlayerThreads(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<DayDiscussionChannel[]> {
  const threads: DayDiscussionChannel[] = [];
  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId)) continue;
    const thread = await findPersonalPlayerThread(
      guild,
      game.channelId,
      game.id,
      player.displayName,
    );
    if (thread && !thread.archived) {
      threads.push(thread as DayDiscussionChannel);
    }
  }
  return threads;
}

export async function isPersonalPlayerThreadChannel(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  channelId: string,
): Promise<boolean> {
  const threads = await listPersonalPlayerThreads(guild, game, engine);
  return threads.some((thread) => thread.id === channelId);
}

export async function collectNominationUpdateChannels(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<DayDiscussionChannel[]> {
  const channels: DayDiscussionChannel[] = [];
  const voting = await resolveVotingChannel(guild, game, engine);
  if (voting) channels.push(voting);
  if (engine.getState().townMode) {
    channels.push(...(await listPersonalPlayerThreads(guild, game, engine)));
  }
  return channels;
}

export async function postNominationEverywhere(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  nominationId: string,
): Promise<{ voteThread: boolean; privateBallots: number }> {
  const voting = await resolveVotingChannel(guild, game, engine);
  let voteThread = false;
  if (voting) {
    voteThread = Boolean(await postNominationToChannel(engine, game.id, voting, nominationId));
  }

  let privateBallots = 0;
  if (engine.getState().townMode) {
    for (const thread of await listPersonalPlayerThreads(guild, game, engine)) {
      const posted = await postNominationToChannel(engine, game.id, thread, nominationId, {
        privateBallot: true,
      });
      if (posted) privateBallots++;
    }
    await refreshStVoteTrackerForGame(guild, game, engine);
  }

  return { voteThread, privateBallots };
}

export async function refreshNominationEverywhere(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  nominationId: string,
  options?: { revealSecret?: boolean },
): Promise<void> {
  const channels = await collectNominationUpdateChannels(guild, game, engine);
  await updateNominationMessagesInChannels(engine, game.id, channels, nominationId, options);
  await refreshStVoteTrackerForGame(guild, game, engine);
}

export async function refreshStVoteTrackerForGame(
  guild: Guild,
  game: { channelId: string },
  engine: GameEngine,
): Promise<void> {
  if (!engine.getState().townMode) return;
  const { upsertStVoteTracker } = await import("../st-vote-tracker.js");
  await upsertStVoteTracker(guild, game.channelId, engine);
}

export async function createTownVoteThread(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const threadName = townVoteThreadName();
  const existing = await findTownVoteThread(guild, game.channelId);
  let thread = existing;

  if (!thread) {
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `Town voting thread for game ${game.id}`,
        ...( {
          type: ChannelType.PrivateThread,
          invitable: false,
        } as Record<string, unknown>),
      });
      await thread
        .send({
          content: [
            "**Town Voting** — nominations and votes happen here.",
            "You can vote on **any open nomination** with the **Vote** button.",
            "Prefer a private ballot? Use the Vote button in your personal ST thread.",
            "Storyteller: `/st resolve-next`, `/st execute`, `/st vote-visibility`, `/st set-vote`.",
          ].join("\n"),
        })
        .catch(() => undefined);
    } catch {
      return null;
    }
  }

  if (thread.archived) {
    await thread.setArchived(false, "Town setup; reopening vote thread.").catch(() => undefined);
  }

  await addDayThreadMembers(guild, thread.id, engine);
  return thread;
}

export async function findTownVoteThread(
  guild: Guild,
  parentChannelId: string,
): Promise<AnyThreadChannel | null> {
  const expectedName = townVoteThreadName();
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) => candidate.parentId === parentChannelId && candidate.name === expectedName,
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;
  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find((candidate) => candidate.name === expectedName) ?? null;
}

export async function requireTownVotingChannel(
  interaction: CommandInteraction,
  game: { id: string; channelId: string },
  engine: GameEngine,
  options?: { allowPersonalThread?: boolean },
): Promise<boolean> {
  const state = engine.getState();
  if (!state.townMode) {
    return requireDayThread(interaction, game, engine);
  }

  if (state.phase !== "day" || !state.day) {
    await replyOrEditInteraction(interaction, {
      content: "Town voting is not open yet. The storyteller must run `/st setup-town`.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  const voteThreadId = state.day.discordThreadId;
  const inTown = interaction.channelId === game.channelId;
  const inVoteThread = Boolean(voteThreadId && interaction.channelId === voteThreadId);
  let inPersonal = false;
  if (options?.allowPersonalThread !== false && interaction.guild) {
    inPersonal = await isPersonalPlayerThreadChannel(
      interaction.guild,
      game,
      engine,
      interaction.channelId,
    );
  }

  if (inTown || inVoteThread || inPersonal) {
    return true;
  }

  const voteHint = voteThreadId
    ? `the voting thread <#${voteThreadId}>`
    : `the town channel <#${game.channelId}>`;
  await replyOrEditInteraction(interaction, {
    content: `Use this command in ${voteHint}, or your private ST thread.`,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function requireDayThread(
  interaction: CommandInteraction,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<boolean> {
  const day = engine.getState().day;
  if (!day?.discordThreadId) {
    await interaction.reply({
      content: "The day thread is not open yet. Wait for the storyteller to start the day.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (interaction.channelId !== day.discordThreadId) {
    await interaction.reply({
      content: `Nomination and voting commands must be used in the day thread: <#${day.discordThreadId}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

export async function createDayThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  dayNumber: number,
  engine: GameEngine,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  try {
    const thread = await parent.threads.create({
      name: dayThreadName(dayNumber),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: `Day ${dayNumber} thread for game ${gameId}`,
    });

    const memberIds = new Set<string>();
    for (const player of engine.getState().players) {
      if (player.alive && (!player.isFake || isDevMode())) {
        memberIds.add(player.discordUserId);
      }
    }
    for (const stId of engine.getStorytellerDiscordIds()) {
      memberIds.add(stId);
    }
    for (const userId of memberIds) {
      await thread.members.add(userId).catch(() => undefined);
    }

    return thread;
  } catch {
    return null;
  }
}

export async function deferInteractionReply(
  interaction: CommandInteraction,
  options: { ephemeral?: boolean } = {},
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply(
      options.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
    );
  } catch (error) {
    if (isInteractionAlreadyAcknowledged(error)) return;
    throw error;
  }
}

export function buildInteractionResponseAttempts(
  interaction: Pick<CommandInteraction, "reply" | "editReply" | "followUp">,
  payload: { content?: string; embeds?: EmbedBuilder[]; flags?: number },
  options: { allowReply?: boolean } = {},
): Array<() => Promise<unknown>> {
  const attempts: Array<() => Promise<unknown>> = [
    () => interaction.editReply(payload),
    () => interaction.followUp(payload),
  ];
  if (options.allowReply !== false) {
    attempts.push(() => interaction.reply(payload));
  }
  return attempts;
}

export async function replyOrEditInteraction(
  interaction: CommandInteraction,
  payload: { content?: string; embeds?: EmbedBuilder[]; flags?: number },
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await deferInteractionReply(interaction, {
      ephemeral: payload.flags === MessageFlags.Ephemeral,
    });
  }

  await withAcknowledgedFallback(
    buildInteractionResponseAttempts(interaction, payload, { allowReply: false }),
  );
}

export async function replyEngineError(
  interaction: Pick<CommandInteraction, "reply" | "editReply" | "followUp"> & {
    deferred?: boolean;
    replied?: boolean;
    commandName?: string;
  },
  error: unknown,
): Promise<void> {
  const message = error instanceof GameEngineError ? error.message : "Unexpected game engine error.";
  if (!(error instanceof GameEngineError)) {
    const cmd = interaction as CommandInteraction;
    void reportError("command.failed", error, {
      command: interaction.commandName ?? "interaction",
      subcommand: cmd.isChatInputCommand?.()
        ? cmd.options.getSubcommand(false) ?? undefined
        : undefined,
      guildId: "guildId" in interaction ? cmd.guildId : undefined,
      channelId: "channelId" in interaction ? cmd.channelId : undefined,
      userId: "user" in interaction ? cmd.user.id : undefined,
    });
  }
  const attempts = buildInteractionResponseAttempts(interaction, {
    content: message,
    flags: MessageFlags.Ephemeral,
  });
  await withAcknowledgedFallback(attempts);
}

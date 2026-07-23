import {
  AnyThreadChannel,
  AutocompleteInteraction,
  CommandInteraction,
  EmbedBuilder,
  Guild,
  ChannelType,
  MessageFlags,
  Role,
  ThreadAutoArchiveDuration,
  type GuildTextBasedChannel,
} from "discord.js";
import {
  appendGameEvent,
  getActiveGameForChannel,
  getActiveGameForVenue,
  listActiveGamesForGuild,
  getGameEvents,
  prisma,
  syncGameProjectionFromEngine,
  type Prisma,
} from "@grimkeeper/database";
import type { ReminderScope } from "@grimkeeper/database";
import {
  GameEngine,
  GameEngineError,
  isFakePlayer,
  type GameEvent,
  type NominationRecord,
  type PlayerState,
} from "@grimkeeper/engine";

import {
  canUseBot,
  canManageChannelReminders,
  fetchGuildMemberWithTimeout,
  getAdminRoleIds,
  getReminderPingRoleId,
  isInExplicitAllowlist,
} from "../access.js";
import { isDevMode } from "../dev.js";
import {
  clearNominationMessageInChannel,
  dayThreadName,
  townVoteThreadName,
  townVoteThreadNameSuffix,
  postNominationToChannel,
  updateNominationMessagesInChannels,
  type DayDiscussionChannel,
} from "../day-thread.js";
import { getBotClient } from "../discord-client.js";
import { buildReminderFireContent } from "../reminder-message.js";
import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isInteractionAlreadyAcknowledged,
  toEditReplyPayload,
  withAcknowledgedFallback,
} from "../interactions/interaction-response.js";
import { logGameEvent } from "../game-events-log.js";
import { refreshGameStatusForEngine } from "../game-status.js";
import { log, serializeError } from "../logger.js";

export function shortGameId(gameId: string): string {
  return gameId.slice(0, 6);
}

/** Prefer 1-week archive; Discord may reject longer durations on unboosted servers. */
export const DEFAULT_THREAD_AUTO_ARCHIVE = ThreadAutoArchiveDuration.OneWeek;

/** Prefer 1-week archive; fall back to 3 days, then 1 day if the guild does not allow it. */
export async function ensureThreadAutoArchive(thread: AnyThreadChannel): Promise<void> {
  if (thread.autoArchiveDuration === DEFAULT_THREAD_AUTO_ARCHIVE) return;

  const fallbacks = [
    ThreadAutoArchiveDuration.OneWeek,
    ThreadAutoArchiveDuration.ThreeDays,
    ThreadAutoArchiveDuration.OneDay,
  ] as const;

  for (const duration of fallbacks) {
    if (thread.autoArchiveDuration === duration) return;
    try {
      await thread.setAutoArchiveDuration(duration);
      return;
    } catch {
      // Try a shorter duration Discord allows for this guild.
    }
  }
}

export function kibThreadName(parentChannelName: string, gameId?: string): string {
  if (gameId) {
    return `kib-${parentChannelName} · ${shortGameId(gameId)}`.slice(0, 100);
  }
  return `kib-${parentChannelName}`.slice(0, 100);
}

export function stPlayerThreadName(displayName: string): string {
  return `ST ${displayName}`.slice(0, 100);
}

export function storytellerThreadName(parentChannelName?: string, gameId?: string): string {
  if (parentChannelName) {
    return kibThreadName(parentChannelName, gameId);
  }
  return gameId ? `kib · ${shortGameId(gameId)}`.slice(0, 100) : "kib";
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

async function resolveParentChannelId(
  interaction: CommandInteraction | AutocompleteInteraction,
): Promise<string | null> {
  if (!interaction.channelId) return null;
  const cached = interaction.channel;
  if (cached?.isThread()) return cached.parentId ?? interaction.channelId;
  if (cached) return interaction.channelId;
  if (interaction.inGuild()) {
    const fetched = await interaction.guild!.channels.fetch(interaction.channelId).catch(() => null);
    if (fetched?.isThread()) return fetched.parentId ?? interaction.channelId;
    if (fetched) return interaction.channelId;
  }
  return interaction.channelId;
}

/** Active game for this interaction’s channel; only falls back to guild when exactly one is active. */
export async function resolveActiveGameForInteraction(
  interaction: CommandInteraction | AutocompleteInteraction,
) {
  if (!interaction.guildId) return null;

  // Match town, kib venue (channel or thread), or log thread by the interaction channel itself.
  if (interaction.channelId) {
    const forVenue = await getActiveGameForVenue(interaction.guildId, interaction.channelId);
    if (forVenue) return forVenue;
  }

  // Threads under town/kib: parent may be the town channel or a kib channel venue.
  const parentChannelId = await resolveParentChannelId(interaction);
  if (parentChannelId && parentChannelId !== interaction.channelId) {
    const forParent = await getActiveGameForVenue(interaction.guildId, parentChannelId);
    if (forParent) return forParent;
  }

  const active = await listActiveGamesForGuild(interaction.guildId);
  if (active.length === 1) return active[0]!;
  return null;
}

export function multipleActiveGamesHint(): string {
  return "Multiple active games in this server — run this from that game’s channel, kib, or Town Voting thread.";
}

export type GamePlayerAutocompleteOptions = {
  /** Only living players (default for nominate). */
  aliveOnly?: boolean;
  /** Exclude this Discord user id (e.g. self). */
  excludeUserId?: string;
  /** Only players with an open nomination (for /vote). */
  openNomineesOnly?: boolean;
  /** Player ids that currently have an open nomination. */
  openNomineeIds?: ReadonlySet<string>;
};

/** Normalize typed autocomplete text (`@Alice`, extra spaces). */
export function normalizePlayerAutocompleteQuery(raw: string): string {
  return raw
    .trim()
    .replace(/^<@!?(\d+)>$/, "$1")
    .replace(/^@+/, "")
    .toLowerCase();
}

export function playerMatchesAutocompleteQuery(
  player: Pick<PlayerState, "displayName" | "discordUserId" | "seat">,
  query: string,
): boolean {
  if (!query) return true;
  const name = player.displayName.toLowerCase();
  if (name.includes(query)) return true;
  if (player.discordUserId.includes(query)) return true;
  if (player.seat != null) {
    const seat = String(player.seat);
    if (seat === query || `seat ${seat}` === query || `#${seat}` === query) return true;
  }
  return false;
}

/**
 * Filter engine roster for Discord autocomplete.
 * Uses the game roster only — do not gate on Discord role.members (partial without GuildMembers intent).
 */
export function filterPlayersForAutocomplete(
  players: PlayerState[],
  options: GamePlayerAutocompleteOptions = {},
  queryRaw = "",
): PlayerState[] {
  let filtered = [...players];

  if (options.aliveOnly) {
    filtered = filtered.filter((player) => player.alive);
  }
  if (options.excludeUserId) {
    filtered = filtered.filter((player) => player.discordUserId !== options.excludeUserId);
  }
  if (options.openNomineesOnly) {
    const openNomineeIds = options.openNomineeIds ?? new Set<string>();
    filtered = filtered.filter((player) => openNomineeIds.has(player.id));
  }

  const query = normalizePlayerAutocompleteQuery(queryRaw);
  return filtered
    .filter((player) => playerMatchesAutocompleteQuery(player, query))
    .sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999))
    .slice(0, 25);
}

/**
 * Autocomplete choices for in-game players (Discord cannot filter USER pickers by role).
 * Source of truth is the engine roster from setup-town.
 */
export async function respondGamePlayerAutocomplete(
  interaction: AutocompleteInteraction,
  options: GamePlayerAutocompleteOptions = {},
): Promise<void> {
  try {
    const game = await resolveActiveGameForInteraction(interaction);
    if (!game) {
      await interaction.respond([]);
      return;
    }

    const engine = await loadEngine(game.id);
    const openNomineeIds = options.openNomineesOnly
      ? new Set(
          (engine.getState().day?.nominations ?? [])
            .filter((nomination) => nomination.status === "open")
            .map((nomination) => nomination.nomineeId),
        )
      : undefined;

    const matches = filterPlayersForAutocomplete(
      engine.getState().players,
      { ...options, openNomineeIds },
      interaction.options.getFocused(true).value,
    );

    await interaction.respond(
      matches.map((player) => {
        const seat = player.seat != null ? `seat ${player.seat}` : "unseated";
        const dead = player.alive ? "" : " · dead";
        return {
          name: `${player.displayName} (${seat}${dead})`.slice(0, 100),
          value: player.discordUserId,
        };
      }),
    );
  } catch (error) {
    log("warn", "autocomplete.players.failed", {
      command: interaction.commandName,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      ...serializeError(error),
    });
    await interaction.respond([]).catch(() => undefined);
  }
}

export async function requireStorytellerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const game = await resolveActiveGameForInteraction(interaction);
  if (!game) {
    const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
    await replyOrEditInteraction(interaction, {
      content:
        activeCount > 1
          ? multipleActiveGamesHint()
          : "No active game found for this channel.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const engine = await loadEngine(game.id);
  const isEngineSt = engine.isStoryteller(interaction.user.id);
  const hasStRole = await memberHasGameStRole(interaction, game);
  const isAllowlistOverride = await isInExplicitAllowlist(interaction);

  // Accept Discord ST role for the linked game (same as reminders) — not only engine storyteller ids.
  // Running from a kib channel/thread resolves the game via kibThreadId first.
  if (!isEngineSt && !hasStRole && !isAllowlistOverride) {
    const detail = !game.stRoleId
      ? " This game has no ST role linked in the DB — re-run `/game setup` with `st:`, or ask an allowlisted ST to `/st do add-st` you."
      : " Need this game’s ST Discord role, engine storyteller status (`/st do add-st`), or `ALLOWED_USER_IDS`.";
    log("info", "st.access.denied", {
      userId: interaction.user.id,
      gameId: game.id,
      channelId: interaction.channelId,
      stRoleId: game.stRoleId ?? null,
      isEngineSt,
      hasStRole,
      isAllowlistOverride,
    });
    await replyOrEditInteraction(interaction, {
      content: `Only storytellers can run this command.${detail}`,
      flags: MessageFlags.Ephemeral,
    });
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
  game: Awaited<ReturnType<typeof getActiveGameForVenue>>;
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

  const game =
    (await getActiveGameForVenue(interaction.guildId, targetChannelId)) ??
    (interaction.channelId
      ? await getActiveGameForVenue(interaction.guildId, interaction.channelId)
      : null);
  if (game) {
    const engine = await loadEngine(game.id);
    const isStoryteller = engine.isStoryteller(interaction.user.id);
    const hasStRole = await memberHasGameStRole(interaction, game);
    const isAllowlistOverride = await isInExplicitAllowlist(interaction);

    if (isStoryteller || hasStRole || isAllowlistOverride) {
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
        "No active game access. Set reminders with the **ST role**, or add your user/role to `ALLOWED_USER_IDS` / `ALLOWED_ROLE_IDS`.",
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
  const gameRoles = await resolveGameRoles(discordGuild, game);
  if (gameRoles) {
    return `<@&${gameRoles.playersRole.id}>`;
  }

  const engine = await loadEngine(gameId);
  const mentions = engine
    .getState()
    .players.filter((player) => !player.isFake)
    .map((player) => `<@${player.discordUserId}>`)
    .join(" ");
  return mentions || null;
}

export { buildReminderFireContent };

export async function requireActivePlayerGame(interaction: CommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  const game = await resolveActiveGameForInteraction(interaction);
  if (!game) {
    const activeCount = (await listActiveGamesForGuild(interaction.guildId)).length;
    await interaction.reply({
      content:
        activeCount > 1
          ? multipleActiveGamesHint()
          : "No active game found for this channel.",
      flags: MessageFlags.Ephemeral,
    });
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

/**
 * Role IDs from the slash/button interaction payload (no REST fetch).
 * Prefer this over guild.members.fetch — we do not request GuildMembers intent, so
 * fetches often time out and falsely deny ST-role users.
 *
 * Returns:
 * - `true` / `false` when the interaction payload lists roles as a string[] (authoritative)
 * - `true` when a GuildMember role cache hits
 * - `null` when there is no member, or a GuildMember cache miss (cache is often incomplete
 *   without Guild Members intent — callers should REST-fetch rather than deny)
 */
export function interactionMemberHasRole(
  interaction: Pick<CommandInteraction, "member">,
  roleId: string,
): boolean | null {
  const member = interaction.member;
  if (!member) return null;

  const roles = member.roles;
  // APIInteractionGuildMember: roles is string[] from the interaction payload — complete.
  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }
  // GuildMember: RoleManager cache. A hit is trustworthy; a miss is not (incomplete cache).
  if (roles && typeof roles === "object" && "cache" in roles) {
    if (roles.cache.has(roleId)) return true;
    return null;
  }
  return null;
}

export async function memberHasGameStRole(
  interaction: CommandInteraction,
  game: GameRoleIds,
): Promise<boolean> {
  if (!game.stRoleId || !interaction.guild) return false;

  // Interaction payload already includes role IDs for guild commands — authoritative and fast.
  const fromPayload = interactionMemberHasRole(interaction, game.stRoleId);
  if (fromPayload !== null) return fromPayload;

  // REST member fetch (does not require Guild Members gateway intent).
  const member = await fetchGuildMemberWithTimeout(interaction.guild, interaction.user.id);
  return member?.roles.cache.has(game.stRoleId) ?? false;
}

export async function requireKibThread(
  interaction: CommandInteraction,
  game: { id: string; channelId: string; kibThreadId?: string | null },
): Promise<boolean> {
  if (!interaction.guild) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  const kib = await getKibThreadForGame(interaction.guild, game);
  if (!kib || interaction.channelId !== kib.id) {
    await replyOrEditInteraction(interaction, {
      content: "Run this from the **kib** channel or thread.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

export async function broadcastToPlayerThreads(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  message: string,
  options?: {
    onProgress?: (done: number, total: number) => Promise<void>;
  },
): Promise<{ sent: number; failed: number }> {
  const threads = await listPersonalPlayerThreads(guild, game, engine, {
    includeArchived: true,
  });
  if (threads.length === 0) return { sent: 0, failed: 0 };

  let done = 0;
  const results = await Promise.all(
    threads.map(async (thread) => {
      try {
        if (thread.isThread() && thread.archived) {
          await thread.setArchived(false, "ST broadcast").catch(() => undefined);
        }
        await thread.send({ content: message });
        return true;
      } catch {
        return false;
      } finally {
        done++;
        if (options?.onProgress) {
          await options.onProgress(done, threads.length).catch(() => undefined);
        }
      }
    }),
  );

  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}

export async function stripGameRolesFromMembers(
  guild: Guild,
  game: GameRoleIds,
  engine: GameEngine,
): Promise<void> {
  const roleIds = [game.stRoleId, game.playerRoleId, game.kibRoleId].filter(
    (roleId): roleId is string => Boolean(roleId),
  );
  if (roleIds.length === 0) return;

  const userIds = new Set<string>();
  for (const player of engine.getState().players) {
    if (!isFakePlayer(player.discordUserId)) {
      userIds.add(player.discordUserId);
    }
  }
  for (const stId of engine.getStorytellerDiscordIds()) {
    userIds.add(stId);
  }

  for (const userId of userIds) {
    for (const roleId of roleIds) {
      await removeRoleFromUser(guild, userId, roleId);
    }
  }
}

export async function clearGameChannelPermissions(
  guild: Guild,
  channelId: string,
  game: GameRoleIds,
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !("permissionOverwrites" in channel)) return;

  if (game.stRoleId) {
    await channel.permissionOverwrites.delete(game.stRoleId).catch(() => undefined);
  }
  if (game.playerRoleId) {
    await channel.permissionOverwrites.delete(game.playerRoleId).catch(() => undefined);
  }
}

export async function finalizeMinimalGameEnd(
  guild: Guild,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
): Promise<void> {
  const { cancelGameReminders } = await import("@grimkeeper/database");
  const { postGameLog } = await import("../game-log-thread.js");
  await cancelGameReminders(game.id);
  await stripGameRolesFromMembers(guild, game, engine);
  await clearGameChannelPermissions(guild, game.channelId, game);
  await openStorytellerThread(guild, game.channelId, game.kibThreadId, game.id);
  const winner = engine.getState().winner;
  await postGameLog(
    guild,
    game,
    `Game ended` +
      (winner ? ` — **${winner}** wins` : "") +
      ` — roles stripped, reminders cancelled, kib opened.` +
      (engine.getStorytellerDiscordIds()[0]
        ? ` Ended by <@${engine.getStorytellerDiscordIds()[0]}>.`
        : ""),
  );
}

type GameRoles = {
  stRole: Role;
  playersRole: Role;
  spectatorRole: Role;
};

export type GameRoleIds = {
  stRoleId?: string | null;
  playerRoleId?: string | null;
  kibRoleId?: string | null;
  kibThreadId?: string | null;
  logThreadId?: string | null;
  channelId: string;
};

export async function resolveGameRoles(
  guild: Guild | null,
  game: GameRoleIds,
): Promise<GameRoles | null> {
  if (!guild) return null;

  if (game.stRoleId && game.playerRoleId && game.kibRoleId) {
    await guild.roles.fetch();
    const stRole = guild.roles.cache.get(game.stRoleId);
    const playersRole = guild.roles.cache.get(game.playerRoleId);
    const spectatorRole = guild.roles.cache.get(game.kibRoleId);
    if (stRole && playersRole && spectatorRole) {
      return { stRole, playersRole, spectatorRole };
    }
    return null;
  }

  return getGameRoles(guild, game.channelId);
}

export function roleSlugFromChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "game";
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

/**
 * Assign a role via REST (no guild.members.fetch).
 * Avoids hanging interaction handlers when member cache/gateway is incomplete.
 */
export async function addRoleToUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  await guild.members.addRole({ user: userId, role: roleId }).catch(() => undefined);
}

export async function removeRoleFromUser(guild: Guild | null, userId: string, roleId: string): Promise<void> {
  if (!guild) return;
  await guild.members.removeRole({ user: userId, role: roleId }).catch(() => undefined);
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
  gameId?: string,
): Promise<void> {
  const thread = await getStorytellerThread(guild, parentChannelId, { gameId });
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
  game: { id: string; channelId: string; kibThreadId?: string | null },
  engine: GameEngine,
): Promise<{
  stThread: KibVenue | null;
  playerThreadsCreated: number;
  playerThreadsFailed: number;
}> {
  const stThread = await ensureStorytellerThread(
    guild,
    game.channelId,
    game.id,
    game.kibThreadId,
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
  // Include game id so successive games in the same channel do not reuse stale threads.
  return `ST ${displayName} · ${gameId.slice(0, 6)}`.slice(0, 100);
}

export function isGameTextChannel(
  channel: { type: ChannelType } | null,
): channel is { type: ChannelType.GuildText | ChannelType.GuildAnnouncement; threads: { create: (...args: never[]) => Promise<AnyThreadChannel> } } {
  return (
    channel !== null &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
  );
}

/** Kib venue: a private/public thread under town, or a dedicated guild text/announcement channel. */
export type KibVenue = GuildTextBasedChannel;

export function isKibVenue(channel: { isTextBased(): boolean; isDMBased(): boolean; isThread(): boolean; type: ChannelType } | null): channel is KibVenue {
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;
  if (channel.isThread()) return true;
  return isGameTextChannel(channel);
}

/** True when kib is stored as a guild channel (not a thread under town). */
export function isKibChannelVenue(channel: { isThread(): boolean; type: ChannelType } | null): boolean {
  return channel !== null && !channel.isThread() && isGameTextChannel(channel);
}

export async function loadParentThreadIndex(
  guild: Guild,
  parentChannelId: string,
): Promise<Map<string, AnyThreadChannel>> {
  const byName = new Map<string, AnyThreadChannel>();

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  if (active) {
    for (const thread of active.threads.values()) {
      if (thread.parentId === parentChannelId) {
        byName.set(thread.name, thread);
      }
    }
  }

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return byName;

  // One archived page is enough for typical player counts; avoid N fetches per player.
  const archived = await parent.threads
    .fetchArchived({ type: "private", limit: 100 })
    .catch(() => null);
  if (archived) {
    for (const thread of archived.threads.values()) {
      if (!byName.has(thread.name)) {
        byName.set(thread.name, thread);
      }
    }
  }

  return byName;
}

export async function findPersonalPlayerThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  displayName: string,
  threadIndex?: Map<string, AnyThreadChannel>,
): Promise<AnyThreadChannel | null> {
  const threadName = personalPlayerThreadName(gameId, displayName);
  const index = threadIndex ?? (await loadParentThreadIndex(guild, parentChannelId));
  return index.get(threadName) ?? null;
}

export async function createKibThread(
  interaction: CommandInteraction,
  gameId: string,
  gameRoles?: GameRoles,
  options?: { kibRoleId?: string; existingThreadId?: string },
): Promise<{ mention: string | null; threadId: string | null }> {
  const guild = interaction.guild;
  const channelId = interaction.channelId;
  if (!guild || !channelId) return { mention: null, threadId: null };

  const parent = await guild.channels.fetch(channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return { mention: null, threadId: null };

  const threadName = kibThreadName(parent.name, gameId);
  let venue: KibVenue | null = null;

  if (options?.existingThreadId) {
    const existing = await guild.channels.fetch(options.existingThreadId).catch(() => null);
    if (existing?.isThread() && existing.parentId === channelId) {
      venue = existing;
    } else if (existing && isKibChannelVenue(existing) && existing.id !== channelId) {
      venue = existing as KibVenue;
    } else {
      return { mention: null, threadId: null };
    }
  } else {
    venue = await getStorytellerThread(guild, channelId, { gameId });
    if (!venue) {
      try {
        const thread = await parent.threads.create({
          name: threadName,
          autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
          reason: `Kib thread for game ${gameId}`,
          ...( {
            type: ChannelType.PrivateThread,
            invitable: false,
          } as Record<string, unknown>),
        });
        venue = thread;
        const roleMention = gameRoles
          ? ` Roles: <@&${gameRoles.stRole.id}> / <@&${gameRoles.playersRole.id}> / kib <@&${gameRoles.spectatorRole.id}>.`
          : "";
        await thread
          .send(`Kib thread ready.${roleMention} Use \`/st add-kib\` to grant kib access.`)
          .catch(() => undefined);
      } catch {
        return { mention: null, threadId: null };
      }
    }
  }

  if (venue.isThread()) {
    if (venue.archived) {
      await venue.setArchived(false, "Game created; reopening kib thread.").catch(() => undefined);
    }
    await ensureThreadAutoArchive(venue);
    await venue.members.add(interaction.user.id).catch(() => undefined);

    const kibRoleId = options?.kibRoleId ?? gameRoles?.spectatorRole.id;
    if (kibRoleId) {
      await addRoleMembersToThread(guild, venue, kibRoleId);
    }
  } else {
    const roleMention = gameRoles
      ? ` Roles: <@&${gameRoles.stRole.id}> / <@&${gameRoles.playersRole.id}> / kib <@&${gameRoles.spectatorRole.id}>.`
      : "";
    await venue
      .send({
        content: `Kib channel attached.${roleMention} Use \`/st add-kib\` to grant kib access.`,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  return { mention: `<#${venue.id}>`, threadId: venue.id };
}

/**
 * Add cached members who already have `roleId` to a private thread.
 *
 * Intentionally does **not** call `guild.members.fetch()` (no args). Without the
 * GuildMembers privileged intent, discord.js waits up to ~120s for gateway chunks
 * that never arrive — that left slash commands stuck on ephemeral "Working…".
 * Callers that know specific user IDs should `thread.members.add(id)` those directly.
 */
export async function addRoleMembersToThread(
  guild: Guild,
  thread: AnyThreadChannel,
  roleId: string,
): Promise<number> {
  let added = 0;
  for (const member of guild.members.cache.values()) {
    if (member.roles.cache.has(roleId)) {
      const ok = await thread.members.add(member.id).then(() => true).catch(() => false);
      if (ok) added++;
    }
  }
  return added;
}

/** Invite engine storytellers + anyone cached with the game ST role into one player ST thread. */
export async function addStorytellersToPlayerThread(
  guild: Guild,
  thread: AnyThreadChannel,
  engine: GameEngine,
  stRoleId?: string | null,
): Promise<void> {
  for (const stId of engine.getStorytellerDiscordIds()) {
    await thread.members.add(stId).catch(() => undefined);
  }
  if (stRoleId) {
    await addRoleMembersToThread(guild, thread, stRoleId);
  }
}

/**
 * Retroactively invite engine STs + ST-role holders into every personal player ST thread.
 * Returns how many threads were updated.
 */
export async function syncStorytellersToPlayerThreads(
  guild: Guild,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
): Promise<{ threads: number }> {
  const threads = await listPersonalPlayerThreads(guild, game, engine, {
    includeArchived: true,
  });
  for (const thread of threads) {
    if (!thread.isThread()) continue;
    if (thread.archived) {
      await thread.setArchived(false, "Syncing storytellers into player ST threads.").catch(
        () => undefined,
      );
    }
    await addStorytellersToPlayerThread(guild, thread, engine, game.stRoleId);
  }
  return { threads: threads.filter((thread) => thread.isThread()).length };
}

/**
 * Create or reopen one player's private ST thread and invite the player + storytellers.
 */
export async function ensurePlayerStThread(
  interaction: CommandInteraction,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
  player: { discordUserId: string; displayName: string },
  options?: {
    threadIndex?: Map<string, AnyThreadChannel>;
    /** Post the “Private ST thread…” intro (default true when newly created). */
    announce?: boolean;
  },
): Promise<{ thread: AnyThreadChannel | null; created: boolean }> {
  const guild = interaction.guild;
  if (!guild) return { thread: null, created: false };
  if (isFakePlayer(player.discordUserId)) return { thread: null, created: false };

  const threadName = personalPlayerThreadName(game.id, player.displayName);
  const threadIndex = options?.threadIndex ?? (await loadParentThreadIndex(guild, game.channelId));
  let thread = threadIndex.get(threadName) ?? null;
  let created = false;

  if (!thread) {
    thread = await createPersonalPlayerThread(
      interaction,
      game.id,
      game.channelId,
      player.discordUserId,
      player.displayName,
    );
    created = Boolean(thread);
    if (thread) threadIndex.set(threadName, thread);
  }

  if (!thread) return { thread: null, created: false };

  if (thread.archived) {
    await thread.setArchived(false, "Reopening player ST thread.").catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  await thread.members.add(player.discordUserId).catch(() => undefined);
  await addStorytellersToPlayerThread(guild, thread, engine, game.stRoleId);

  const shouldAnnounce = options?.announce ?? created;
  if (shouldAnnounce) {
    await thread
      .send({
        content: `Private ST thread for <@${player.discordUserId}>. Only you, the storyteller, and server admins can access this thread.`,
        allowedMentions: { users: [player.discordUserId] },
      })
      .catch(() => undefined);
  }

  return { thread, created };
}

export async function createPlayerStThreads(
  interaction: CommandInteraction,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
): Promise<{ created: number; failed: number }> {
  const guild = interaction.guild;
  if (!guild) return { created: 0, failed: 0 };

  let created = 0;
  let failed = 0;
  const threadIndex = await loadParentThreadIndex(guild, game.channelId);

  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId)) continue;

    const result = await ensurePlayerStThread(interaction, game, engine, player, {
      threadIndex,
      announce: true,
    });
    if (result.thread) created++;
    else failed++;
  }

  return { created, failed };
}

export async function ensureStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  kibThreadId?: string | null,
): Promise<KibVenue | null> {
  let venue = await getStorytellerThread(guild, parentChannelId, { gameId, kibThreadId });
  if (!venue) {
    const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
    if (!isGameTextChannel(parent)) return null;

    const threadName = storytellerThreadName(parent.name, gameId);

    try {
      const thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
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
      venue = thread;
    } catch {
      return null;
    }
  }

  if (venue.isThread()) {
    if (venue.archived) {
      await venue.setArchived(false, "Game started; reopening storyteller thread.").catch(() => undefined);
    }
    await ensureThreadAutoArchive(venue);
  }

  return venue;
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
    await ensureThreadAutoArchive(existing);
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
  if (thread?.isThread()) {
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
      autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
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
  gameId?: string,
): boolean {
  if (candidate.parentId !== parentChannelId) return false;
  const expectedName = storytellerThreadName(parentChannelName, gameId);
  return candidate.name === expectedName;
}

export async function getStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  options?: { kibThreadId?: string | null; gameId?: string },
): Promise<KibVenue | null> {
  if (options?.kibThreadId) {
    const byId = await guild.channels.fetch(options.kibThreadId).catch(() => null);
    if (byId && isKibChannelVenue(byId)) {
      return byId as KibVenue;
    }
    if (byId?.isThread() && byId.parentId === parentChannelId) {
      if (options.gameId) {
        const short = shortGameId(options.gameId);
        if (byId.name.includes(" · ") && !byId.name.includes(short)) {
          // Stale cross-game kibThreadId — fall through to name lookup.
        } else {
          return byId;
        }
      } else {
        return byId;
      }
    }
  }

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  const parentChannelName = parent && "name" in parent ? parent.name : undefined;
  const expectedNames = new Set<string>();
  const scoped = storytellerThreadName(parentChannelName, options?.gameId);
  expectedNames.add(scoped);
  // Migrate older kib threads that predate game-id suffixes.
  if (options?.gameId && parentChannelName) {
    expectedNames.add(kibThreadName(parentChannelName));
  }

  const matchesName = (candidate: { parentId: string | null; name: string }) =>
    candidate.parentId === parentChannelId && expectedNames.has(candidate.name);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread =
    active?.threads.find((candidate) => candidate.name === scoped && matchesName(candidate)) ??
    active?.threads.find((candidate) => matchesName(candidate));
  if (activeThread) return activeThread;

  if (!isGameTextChannel(parent)) return null;

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return (
    archived?.threads.find((candidate) => candidate.name === scoped && matchesName(candidate)) ??
    archived?.threads.find((candidate) => matchesName(candidate)) ??
    null
  );
}

export async function getKibThreadForGame(
  guild: Guild,
  game: { id: string; channelId: string; kibThreadId?: string | null },
): Promise<KibVenue | null> {
  return getStorytellerThread(guild, game.channelId, {
    kibThreadId: game.kibThreadId,
    gameId: game.id,
  });
}

export async function openStorytellerThread(
  guild: Guild,
  parentChannelId: string,
  kibThreadId?: string | null,
  gameId?: string,
): Promise<KibVenue | null> {
  const venue = await getStorytellerThread(guild, parentChannelId, { kibThreadId, gameId });
  if (!venue) return null;

  if (venue.isThread()) {
    await venue
      .edit({
        archived: false,
        locked: false,
        invitable: true,
        reason: "Game ended; opening storyteller thread for post-game discussion.",
      })
      .catch(() => undefined);
  }

  await venue
    .send(
      venue.isThread()
        ? "Game ended — this thread is now open for post-game discussion."
        : "Game ended — this channel is open for post-game discussion.",
    )
    .catch(() => undefined);
  return venue;
}

export async function resolveVotingChannel(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<DayDiscussionChannel | null> {
  const state = engine.getState();
  const dayThreadId = state.day?.discordThreadId;

  if (dayThreadId) {
    const thread = await guild.channels.fetch(dayThreadId).catch(() => null);
    if (thread?.isThread() && thread.parentId === game.channelId) {
      const short = shortGameId(game.id);
      if (state.townMode) {
        // After `/st mark` remaps a former vote thread to Rules/Claims/etc., ignore the stale ID.
        if (thread.name.includes("Town Voting") && thread.name.includes(short)) {
          return thread as DayDiscussionChannel;
        }
      } else if (!thread.name.includes(" · ") || thread.name.includes(short)) {
        return thread as DayDiscussionChannel;
      }
    }
  }

  if (state.townMode) {
    const byName = await findTownVoteThread(guild, game.channelId, game.id);
    if (byName) return byName as DayDiscussionChannel;

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
  options?: { includeArchived?: boolean },
): Promise<DayDiscussionChannel[]> {
  const threadIndex = await loadParentThreadIndex(guild, game.channelId);
  const threads: DayDiscussionChannel[] = [];
  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId)) continue;
    const thread = threadIndex.get(personalPlayerThreadName(game.id, player.displayName));
    if (!thread) continue;
    if (thread.archived && !options?.includeArchived) continue;
    threads.push(thread as DayDiscussionChannel);
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
  return channels;
}

export async function postNominationEverywhere(
  guild: Guild,
  game: GameRoleIds & {
    id: string;
    channelId: string;
    kibThreadId?: string | null;
    guildId?: string;
  },
  engine: GameEngine,
  nominationId: string,
): Promise<{ voteThread: boolean }> {
  const voting = await resolveVotingChannel(guild, game, engine);
  let voteThread = false;
  if (voting) {
    let pingRoleId = game.playerRoleId ?? null;
    if (!pingRoleId) {
      const stored = await prisma.game.findUnique({
        where: { id: game.id },
        select: { playerRoleId: true, stRoleId: true, kibRoleId: true },
      });
      pingRoleId = stored?.playerRoleId ?? null;
      if (stored) {
        game = { ...game, ...stored };
      }
    }
    const roles = await resolveGameRoles(guild, game);
    voteThread = Boolean(
      await postNominationToChannel(engine, game.id, voting, nominationId, {
        pingRoleId: roles?.playersRole.id ?? pingRoleId,
      }),
    );
  }

  if (engine.getState().townMode) {
    await refreshStVoteTrackerForGame(guild, game, engine);
  }

  const { scheduleNominationVoteDeadlineReminder } = await import("../interactions/lock-votes.js");
  await scheduleNominationVoteDeadlineReminder(
    guild,
    {
      id: game.id,
      channelId: game.channelId,
      kibThreadId: game.kibThreadId,
      guildId: game.guildId ?? engine.getState().guildId,
    },
    engine,
    nominationId,
  ).catch(() => undefined);

  return { voteThread };
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

  // Disable Vote buttons on leftover private-ballot embeds in personal ST threads.
  if (engine.getState().townMode) {
    for (const thread of await listPersonalPlayerThreads(guild, game, engine)) {
      await clearNominationMessageInChannel(thread, nominationId);
    }
  }

  await refreshStVoteTrackerForGame(guild, game, engine);
}

/** Refresh every nomination embed (e.g. after resolve updates block contest for all open noms). */
export async function refreshAllNominationEverywhere(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  options?: { revealSecret?: boolean },
): Promise<void> {
  const nominationIds = engine.getState().day?.nominations.map((nomination) => nomination.id) ?? [];
  const channels = await collectNominationUpdateChannels(guild, game, engine);
  for (const nominationId of nominationIds) {
    await updateNominationMessagesInChannels(engine, game.id, channels, nominationId, options);
  }

  if (engine.getState().townMode) {
    for (const thread of await listPersonalPlayerThreads(guild, game, engine)) {
      for (const nominationId of nominationIds) {
        await clearNominationMessageInChannel(thread, nominationId);
      }
    }
  }

  await refreshStVoteTrackerForGame(guild, game, engine);
}

export async function refreshStVoteTrackerForGame(
  guild: Guild,
  game: { channelId: string; kibThreadId?: string | null },
  engine: GameEngine,
): Promise<void> {
  if (!engine.getState().townMode) return;
  const { upsertStVoteTracker } = await import("../st-vote-tracker.js");
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
}

/**
 * Ensure Town Voting exists. Same pattern as Whisper Declaration / Claims / Rules:
 * public thread + @mention ST / player / kib roles (no per-player member adds).
 */
export async function createTownVoteThread(
  guild: Guild,
  game: GameRoleIds & { id: string; channelId: string },
  _engine: GameEngine,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const threadName = townVoteThreadName(game.id);
  const existing = await findTownVoteThread(guild, game.channelId, game.id);
  let thread = existing;

  if (!thread) {
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
        reason: `Town voting thread for game ${game.id}`,
        ...( {
          type: ChannelType.PublicThread,
        } as Record<string, unknown>),
      });
      const roleIds = [game.stRoleId, game.playerRoleId, game.kibRoleId].filter(
        (id): id is string => Boolean(id),
      );
      const introLines = [
        "**Town Voting** — nominations and votes happen here once Day begins.",
        "After setup-town the game is in **Setup**. The storyteller runs `/st next-phase` for Night 1, then again for Day 1.",
        "You can vote on **any open nomination** with the **Vote** button.",
        "Prefer a private ballot? Use `/privatevote` (ST sees it on the kib vote tracker).",
        "Players: `/nominate` / `/defend` / `/vote` / `/privatevote` / `/roster` / `/whisper`.",
        "Storyteller: kib **control panel**, or `/st do` (`resolve-next`, `close-nominations`, `next-phase`, `execute`, `nominate`, `vote-visibility`, …).",
      ];
      if (roleIds.length > 0) {
        introLines.unshift(roleIds.map((id) => `<@&${id}>`).join(" "));
      }
      await thread
        .send({
          content: introLines.join("\n"),
          allowedMentions: { roles: roleIds },
        })
        .catch(() => undefined);
    } catch {
      return null;
    }
  } else if (thread.name !== threadName) {
    await thread.setName(threadName, "Restore Town Voting thread name").catch(() => undefined);
  }

  if (thread.archived) {
    await thread.setArchived(false, "Town setup; reopening vote thread.").catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  return thread;
}

export async function findTownVoteThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
): Promise<AnyThreadChannel | null> {
  const suffix = townVoteThreadNameSuffix(gameId);
  const matchesGame = (name: string) =>
    name.endsWith(suffix) || name.includes(suffix);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) => candidate.parentId === parentChannelId && matchesGame(candidate.name),
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  // Prefer public (current); still find legacy private Town Voting threads.
  for (const type of ["public", "private"] as const) {
    const archived = await parent.threads.fetchArchived({ type }).catch(() => null);
    const match = archived?.threads.find((candidate) => matchesGame(candidate.name));
    if (match) return match;
  }
  return null;
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
      content:
        state.phase === "night"
          ? `It is **Night ${state.nightNumber}**. Nominations are closed until the storyteller starts the next day (\`/st next-phase\`).`
          : "Town voting is not open yet. The storyteller must run `/st setup-town`.",
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

  let stHint = "your private ST thread";
  if (interaction.guild) {
    const player = engine.getPlayerByDiscordId(interaction.user.id);
    if (player) {
      const stThread = await findPersonalPlayerThread(
        interaction.guild,
        game.channelId,
        game.id,
        player.displayName,
      );
      if (stThread) {
        stHint = `your private ST thread <#${stThread.id}>`;
      }
    }
  }

  await replyOrEditInteraction(interaction, {
    content: `Use this command in ${voteHint}, or ${stHint}.`,
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
      autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
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
  options: { ephemeral?: boolean; content?: string } = {},
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.reply({
      content: options.content ?? INTERACTION_PENDING_CONTENT,
      ...(options.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    });
  } catch (error) {
    if (isInteractionAlreadyAcknowledged(error)) return;
    throw error;
  }
}

/** Update the pending ack message while a long command is still running. */
export async function setInteractionProgress(
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await deferInteractionReply(interaction, { ephemeral: true, content });
    return;
  }
  await interaction.editReply({ content }).catch(() => undefined);
}

export function buildInteractionResponseAttempts(
  interaction: Pick<CommandInteraction, "reply" | "editReply" | "followUp">,
  payload: { content?: string; embeds?: EmbedBuilder[]; flags?: number },
  options: { allowReply?: boolean } = {},
): Array<() => Promise<unknown>> {
  const editPayload = toEditReplyPayload(payload);
  const attempts: Array<() => Promise<unknown>> = [
    () => interaction.editReply(editPayload),
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

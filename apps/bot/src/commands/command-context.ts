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
  getGameForChannelIncludingEnded,
  listActiveGamesForGuild,
  listEngineStorytellerGameIds,
  listGameWhispers,
  getGameEvents,
  prisma,
  resolveArchiveCategoryId,
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
  memberHasAnyRole,
  type AccessInteraction,
} from "../access.js";
import { isDevMode } from "../dev.js";
import {
  clearNominationMessageInChannel,
  dayThreadName,
  ensureDiscussionChannelSendable,
  legacyTownVoteThreadName,
  townVoteThreadName,
  postNominationToChannelDetailed,
  updateNominationMessagesInChannels,
  type DayDiscussionChannel,
} from "../day-thread.js";
import { getBotClient } from "../discord-client.js";
import { buildReminderFireContent } from "../reminder-message.js";
import { reportError } from "../error-reporter.js";
import {
  INTERACTION_PENDING_CONTENT,
  isInteractionAlreadyAcknowledged,
  isRecoverableInteractionResponseError,
  isUnknownInteractionError,
  splitDiscordContent,
  toEditReplyPayload,
  withAcknowledgedFallback,
} from "../interactions/interaction-response.js";
import { logGameEvent } from "../game-events-log.js";
import { refreshGameStatusForEngine } from "../game-status.js";
import { log, serializeError } from "../logger.js";

export function shortGameId(gameId: string): string {
  return gameId.slice(0, 6);
}

/** Legacy `· <shortId>` suffix used before ID-based thread lookup. */
export function legacyGameNameSuffix(gameId: string): string {
  return `· ${shortGameId(gameId)}`;
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

/** Clean kib thread name (resolved via `kibThreadId`, not the short game id). */
export function kibThreadName(parentChannelName: string, _gameId?: string): string {
  return `kib-${parentChannelName}`.slice(0, 100);
}

export function legacyKibThreadName(parentChannelName: string, gameId: string): string {
  return `kib-${parentChannelName} ${legacyGameNameSuffix(gameId)}`.slice(0, 100);
}

export function stPlayerThreadName(displayName: string): string {
  return `ST ${displayName}`.slice(0, 100);
}

/** @deprecated Prefer `stPlayerThreadName`; kept for call sites that still pass gameId. */
export function personalPlayerThreadName(_gameId: string, displayName: string): string {
  return stPlayerThreadName(displayName);
}

export function legacyPersonalPlayerThreadName(gameId: string, displayName: string): string {
  return `ST ${displayName} ${legacyGameNameSuffix(gameId)}`.slice(0, 100);
}

export function storytellerThreadName(parentChannelName?: string, _gameId?: string): string {
  if (parentChannelName) {
    return kibThreadName(parentChannelName);
  }
  return "kib";
}

export function legacyStorytellerThreadName(parentChannelName: string | undefined, gameId: string): string {
  if (parentChannelName) {
    return legacyKibThreadName(parentChannelName, gameId);
  }
  return `kib ${legacyGameNameSuffix(gameId)}`.slice(0, 100);
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

export async function resolveParentChannelId(interaction: {
  channelId: string | null;
  channel?: CommandInteraction["channel"] | null;
  guild?: Guild | null;
  inGuild?: () => boolean;
}): Promise<string | null> {
  if (!interaction.channelId) return null;
  const cached = interaction.channel;
  if (cached?.isThread()) return cached.parentId ?? null;
  if (cached) return interaction.channelId;
  const inGuild =
    typeof interaction.inGuild === "function" ? interaction.inGuild() : Boolean(interaction.guild);
  if (inGuild && interaction.guild) {
    const fetched = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (fetched?.isThread()) return fetched.parentId ?? null;
    if (fetched) return interaction.channelId;
  }
  return interaction.channelId;
}

/** Town/kib/voting parent ids for venue matching (thread parent when applicable). */
export async function resolveInteractionVenueChannelIds(interaction: {
  channelId: string | null;
  channel?: CommandInteraction["channel"] | null;
  guild?: Guild | null;
  inGuild?: () => boolean;
}): Promise<string[]> {
  if (!interaction.channelId) return [];

  const ids = new Set<string>([interaction.channelId]);
  const parentId = await resolveParentChannelId(interaction);

  if (parentId && parentId !== interaction.channelId) {
    ids.add(parentId);
    return [...ids];
  }

  // Cached channel missing — re-fetch so thread parent lookup is not skipped.
  if (interaction.guild) {
    const fetched = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (fetched?.isThread() && fetched.parentId && fetched.parentId !== interaction.channelId) {
      ids.add(fetched.parentId);
    }
  }

  return [...ids];
}

type ActiveGuildGame = Awaited<ReturnType<typeof listActiveGamesForGuild>>[number];

/**
 * When DB venue ids are missing/stale, match via Discord (kib thread name, Town Voting, parent town).
 * Only returns a game when the match is unambiguous for this channel context.
 */
async function resolveActiveGameFromDiscordVenue(
  guild: Guild,
  guildId: string,
  venueChannelIds: readonly string[],
): Promise<ActiveGuildGame | null> {
  const active = await listActiveGamesForGuild(guildId);
  if (active.length === 0) return null;

  const venueIds = new Set(venueChannelIds);
  const matched: ActiveGuildGame[] = [];

  for (const game of active) {
    if (venueIds.has(game.channelId)) {
      matched.push(game);
      continue;
    }

    const kib = await getKibThreadForGame(guild, game);
    if (kib && venueIds.has(kib.id)) {
      matched.push(game);
      continue;
    }

    const voting = await findTownVoteThread(guild, game.channelId, game.id, game.votingThreadId);
    if (voting && venueIds.has(voting.id)) {
      matched.push(game);
      continue;
    }

    let matchesVenueThread = false;
    for (const venueId of venueIds) {
      const channel = await guild.channels.fetch(venueId).catch(() => null);
      if (!channel?.isThread()) continue;
      if (channel.parentId === game.channelId) {
        matchesVenueThread = true;
        break;
      }
      if (kib && isKibChannelVenue(kib) && channel.parentId === kib.id) {
        matchesVenueThread = true;
        break;
      }
    }
    if (matchesVenueThread) {
      matched.push(game);
    }
  }

  const unique = [...new Map(matched.map((game) => [game.id, game])).values()];
  if (unique.length === 1) return unique[0]!;

  if (unique.length > 1) {
    const byTownChannel = unique.filter((game) => venueIds.has(game.channelId));
    if (byTownChannel.length === 1) return byTownChannel[0]!;
  }

  return null;
}

/**
 * Active game for this interaction’s channel / parent venue only.
 * Does not fall back to “the only active game in the guild” — that caused leftover
 * games to steal ST commands from unrelated channels (and made `/game list` look wrong).
 */
export async function resolveActiveGameForInteraction(interaction: {
  guildId: string | null;
  channelId: string | null;
  channel?: CommandInteraction["channel"] | null;
  guild?: Guild | null;
  inGuild?: () => boolean;
}) {
  if (!interaction.guildId || !interaction.channelId) return null;

  const venueChannelIds = await resolveInteractionVenueChannelIds(interaction);

  for (const venueId of venueChannelIds) {
    const forVenue = await getActiveGameForVenue(interaction.guildId, venueId);
    if (forVenue) return forVenue;
  }

  if (interaction.guild) {
    const fromDiscord = await resolveActiveGameFromDiscordVenue(
      interaction.guild,
      interaction.guildId,
      venueChannelIds,
    );
    if (fromDiscord) return fromDiscord;
  }

  return null;
}

export function multipleActiveGamesHint(): string {
  return "Multiple active games in this server — run this from that game’s channel, kib, or Town Voting thread.";
}

/** Ephemeral hint when this channel isn’t a venue for any active game. */
export async function noActiveGameHereMessage(guildId: string): Promise<string> {
  const active = await listActiveGamesForGuild(guildId);
  if (active.length > 1) return multipleActiveGamesHint();
  if (active.length === 1) {
    const game = active[0]!;
    const kib = game.kibThreadId ? ` · kib <#${game.kibThreadId}>` : "";
    return (
      `No active game in **this** channel. Leftover: \`${game.id.slice(0, 8)}\` in <#${game.channelId}>${kib} ` +
      `(phase **${game.phase}**). Run commands there, or \`/st end\` there to clear it. Use \`/game list\` for all.`
    );
  }
  return "No active game found for this channel.";
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
    await replyOrEditInteraction(interaction, {
      content: await noActiveGameHereMessage(interaction.guildId),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const engine = await loadEngine(game.id);
  if (!(await canActAsStoryteller(interaction, game, engine))) {
    const roleHint = game.stRoleId ? ` <@&${game.stRoleId}>` : "";
    const detail = !game.stRoleId
      ? " This game has no ST role linked in the DB — re-run `/game setup` with `st:`."
      : ` Need this game’s ST Discord role${roleHint} (or \`ADMIN_IDS\`).`;
    log("info", "st.access.denied", {
      userId: interaction.user.id,
      gameId: game.id,
      channelId: interaction.channelId,
      stRoleId: game.stRoleId ?? null,
    });
    await replyOrEditInteraction(interaction, {
      content: `Only holders of this game’s storyteller role can run this command.${detail}`,
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
        "No active game access. Set reminders with the **ST role**, or add your user/role to `ADMIN_IDS` / `ALLOWED_ROLE_IDS`.",
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
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const game = await resolveActiveGameForInteraction(interaction);
  if (!game) {
    await replyOrEditInteraction(interaction, {
      content: await noActiveGameHereMessage(interaction.guildId),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const engine = await loadEngine(game.id);
  const player = engine.getPlayerByDiscordId(interaction.user.id);
  if (!player) {
    await replyOrEditInteraction(interaction, {
      content: "You are not in this game.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return { game, engine, player };
}

const BOT_ACCESS_DENIED_MESSAGE =
  "You are not allowed to use this bot. Ask an admin to add your user ID " +
  "to `ADMIN_IDS` or one of your role IDs to `ALLOWED_ROLE_IDS`.";

async function replyAccessDenied(interaction: CommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: BOT_ACCESS_DENIED_MESSAGE, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: BOT_ACCESS_DENIED_MESSAGE, flags: MessageFlags.Ephemeral });
  }
}

/** True when the user is seated in an active game in this guild (any venue). */
export async function isActiveGamePlayer(interaction: CommandInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;

  const venueGame = await resolveActiveGameForInteraction(interaction);
  if (venueGame?.players.some((player) => player.discordUserId === interaction.user.id)) {
    return true;
  }

  const games = await listActiveGamesForGuild(interaction.guildId);
  return games.some((game) =>
    game.players.some((player) => player.discordUserId === interaction.user.id),
  );
}

/** True when the user holds an active game’s ST Discord role or is an engine ST in this guild. */
export async function isActiveGameStoryteller(interaction: AccessInteraction): Promise<boolean> {
  if (!interaction.guildId || !interaction.user?.id) return false;

  const games = await listActiveGamesForGuild(interaction.guildId);
  if (games.length === 0) return false;

  const stRoleIds = [
    ...new Set(games.map((game) => game.stRoleId).filter((id): id is string => Boolean(id))),
  ];
  if (stRoleIds.length > 0 && (await memberHasAnyRole(interaction, stRoleIds))) {
    return true;
  }

  const engineIds = await listEngineStorytellerGameIds(interaction.user.id);
  if (engineIds.length === 0) return false;
  const activeIds = new Set(games.map((game) => game.id));
  return engineIds.some((id) => activeIds.has(id));
}

export type CommandAccessOptions = {
  /** Extra Discord role IDs that grant access (e.g. the ST role passed to `/game setup`). */
  extraRoleIds?: readonly string[];
};

/**
 * Global allowlist, optional extra roles (setup ST), or ST of an active game in this guild.
 * Day-play uses `requireDayPlayAccess` so seated players are not locked out.
 */
export async function userHasCommandAccess(
  interaction: AccessInteraction,
  options?: CommandAccessOptions,
): Promise<boolean> {
  if (await canUseBot(interaction)) return true;
  if (options?.extraRoleIds?.length && (await memberHasAnyRole(interaction, options.extraRoleIds))) {
    return true;
  }
  return isActiveGameStoryteller(interaction);
}

export async function requireCommandAccess(
  interaction: CommandInteraction,
  options?: CommandAccessOptions,
): Promise<boolean> {
  if (await userHasCommandAccess(interaction, options)) return true;
  await replyAccessDenied(interaction);
  return false;
}

/**
 * Day-play commands (`/nominate`, `/vote`, `/whisper`, …): allowlist **or** seated in an
 * active game. Global allowlist alone would lock out normal players.
 */
export async function requireDayPlayAccess(interaction: CommandInteraction): Promise<boolean> {
  if (await canUseBot(interaction)) return true;
  if (await isActiveGamePlayer(interaction)) return true;
  await replyAccessDenied(interaction);
  return false;
}

export { interactionMemberHasRole } from "../access.js";

export async function memberHasGameStRole(
  interaction: {
    user: { id: string };
    guild: Guild | null;
    member?: CommandInteraction["member"];
  },
  game: GameRoleIds,
): Promise<boolean> {
  if (!interaction.guild) return false;

  let stRoleId = game.stRoleId ?? null;
  // Older games / partial rows: resolve st-<town-slug> when DB id is missing.
  if (!stRoleId) {
    const roles = await resolveGameRoles(interaction.guild, game);
    stRoleId = roles?.stRole.id ?? null;
  }
  if (!stRoleId) return false;

  return memberHasAnyRole(interaction, [stRoleId]);
}

/**
 * `/st` access: game Discord ST role is the source of truth; engine ST + allowlist still count.
 * Use for buttons/selects (control panel, vote tracker) as well as slash commands.
 */
export async function canActAsStoryteller(
  interaction: {
    user: { id: string };
    guild: Guild | null;
    guildId?: string | null;
    member?: CommandInteraction["member"];
  },
  game: GameRoleIds,
  engine: { isStoryteller: (userId: string) => boolean },
): Promise<boolean> {
  if (await memberHasGameStRole(interaction, game)) return true;
  if (engine.isStoryteller(interaction.user.id)) return true;
  if (await isInExplicitAllowlist(interaction)) return true;
  return false;
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

export function uniqueGameRoleIds(game: GameRoleIds): string[] {
  return [
    ...new Set(
      [game.stRoleId, game.playerRoleId, game.kibRoleId].filter((id): id is string => Boolean(id)),
    ),
  ];
}

export async function stripGameRolesFromMembers(
  guild: Guild,
  game: GameRoleIds,
  engine?: Pick<GameEngine, "getState" | "getStorytellerDiscordIds"> | null,
  extraUserIds?: Iterable<string>,
): Promise<{ users: number; removed: number }> {
  const roleIds = uniqueGameRoleIds(game);
  if (roleIds.length === 0) return { users: 0, removed: 0 };

  const userIds = new Set<string>();
  if (engine) {
    for (const player of engine.getState().players) {
      if (!isFakePlayer(player.discordUserId)) {
        userIds.add(player.discordUserId);
      }
    }
    for (const stId of engine.getStorytellerDiscordIds()) {
      userIds.add(stId);
    }
  }
  // Cached members only — do not guild.members.fetch() (no GuildMembers intent).
  for (const member of guild.members.cache.values()) {
    if (roleIds.some((roleId) => member.roles.cache.has(roleId))) {
      userIds.add(member.id);
    }
  }
  if (extraUserIds) {
    for (const userId of extraUserIds) userIds.add(userId);
  }

  let removed = 0;
  for (const userId of userIds) {
    for (const roleId of roleIds) {
      if (await removeRoleFromUser(guild, userId, roleId)) removed++;
    }
  }
  return { users: userIds.size, removed };
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
  
  if (winner !== "good" && winner !== "evil") {
    await prisma.game.delete({ where: { id: game.id } });
    await postGameLog(
      guild,
      game,
      "Game cancelled by storyteller.",
    );
  } else {
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
}

/** Channel overwrites: publicly readable, no posts / new threads. */
export const ARCHIVE_CHANNEL_READONLY = {
  ViewChannel: true,
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
} as const;

/** Extra denies on game roles so leftover overwrites cannot keep SendMessagesInThreads. */
export const ARCHIVE_ROLE_READONLY = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  ManageThreads: false,
  AddReactions: false,
} as const;

export type ArchiveGameSurfacesResult = {
  channels: number;
  threads: number;
  movedChannels: number;
  rolesStripped: number;
};

export type ArchivableGame = NonNullable<Awaited<ReturnType<typeof getGameForChannelIncludingEnded>>>;

/**
 * Lock all active and archived threads under a channel (no DB game required).
 * Used when the channel has no known game row, or to supplement DB-based archiving.
 */
export async function archiveChannelThreadsDirectly(
  guild: Guild,
  channelId: string,
  reason = "Game archived — read only.",
): Promise<{ threads: number }> {
  const parent = await guild.channels.fetch(channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return { threads: 0 };

  let threads = 0;

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  if (active) {
    for (const thread of active.threads.values()) {
      if (thread.parentId !== channelId) continue;
      if (await lockThreadReadOnly(thread, reason)) threads++;
    }
  }

  for (const type of ["public", "private"] as const) {
    const archived = await parent.threads.fetchArchived({ type, limit: 100 }).catch(() => null);
    if (!archived) continue;
    for (const thread of archived.threads.values()) {
      if (await lockThreadReadOnly(thread, reason)) threads++;
    }
  }

  return { threads };
}

export async function requireArchivableGame(interaction: CommandInteraction): Promise<
  | { game: ArchivableGame; engine: GameEngine; channelId: string; noDbRow: false }
  | { game: null; engine: null; channelId: string; noDbRow: true }
  | null
> {
  if (!interaction.guildId) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  // Must run from the town channel itself, not from kib or a thread, to avoid ambiguity.
  const cached = interaction.channel;
  const channelIsThread =
    (cached != null ? cached.isThread() : null) ??
    (interaction.guild
      ? (await interaction.guild.channels.fetch(interaction.channelId).catch(() => null))?.isThread() ?? false
      : false);

  if (channelIsThread) {
    await replyOrEditInteraction(interaction, {
      content:
        "Run `/st do archive` from the **town channel** directly, not from a thread or kib. This prevents accidentally archiving the wrong game.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const channelId = interaction.channelId;
  if (!channelId) {
    await replyOrEditInteraction(interaction, {
      content: "This command must be used in a channel.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const game = await getGameForChannelIncludingEnded(interaction.guildId, channelId);

  if (!game) {
    // No DB row — still allow archiving Discord threads directly (admin-only).
    if (!(await isInExplicitAllowlist(interaction))) {
      await replyOrEditInteraction(interaction, {
        content:
          "No game record found for this channel. Run from the town channel, or add your user ID to `ADMIN_IDS` to archive an unrecognised channel.",
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }
    return { game: null, engine: null, channelId, noDbRow: true };
  }

  const engine = await loadEngine(game.id);
  if (!(await canActAsStoryteller(interaction, game, engine))) {
    const roleHint = game.stRoleId ? ` <@&${game.stRoleId}>` : "";
    await replyOrEditInteraction(interaction, {
      content: `Only holders of this game's storyteller role can archive.${roleHint ? ` Need${roleHint} (or \`ADMIN_IDS\`).` : " Or `ADMIN_IDS`."}`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return { game, engine, channelId, noDbRow: false };
}
export async function applyArchiveChannelPermissions(
  guild: Guild,
  channelId: string,
  game: GameRoleIds,
): Promise<boolean> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !("permissionOverwrites" in channel)) return false;

  await channel.permissionOverwrites.edit(guild.id, ARCHIVE_CHANNEL_READONLY).catch(() => undefined);

  for (const roleId of [game.stRoleId, game.playerRoleId, game.kibRoleId]) {
    if (!roleId) continue;
    await channel.permissionOverwrites.edit(roleId, ARCHIVE_ROLE_READONLY).catch(() => undefined);
  }

  return true;
}

/**
 * Unarchive (so history is browsable) then lock a thread read-only.
 * Private threads also have invitable set to false.
 * Public threads become readable by anyone with channel access; private threads stay
 * visible only to existing members, but no one can post.
 */
export async function lockThreadReadOnly(
  thread: AnyThreadChannel,
  reason = "Game archived — read only.",
): Promise<boolean> {
  try {
    if (thread.archived) {
      await thread.setArchived(false, reason).catch(() => undefined);
    }
    await thread.setLocked(true, reason);
    if (thread.type === ChannelType.PrivateThread) {
      await thread.edit({ invitable: false }).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a guild text/announcement channel into the configured Archives category.
 * No-op when already in that category or when the channel cannot be reparented.
 */
export async function moveChannelToArchiveCategory(
  guild: Guild,
  channelId: string,
  categoryId: string,
): Promise<boolean> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased() || channel.isThread()) return false;
  if (!isGameTextChannel(channel)) return false;
  if (channel.parentId === categoryId) return false;

  try {
    await channel.setParent(categoryId, {
      lockPermissions: false,
      reason: "Game archived — move to Archives category.",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open town (+ kib channel, if any) for everyone to read and freeze all related
 * channels/threads as read-only. Private ST/whisper/kib threads stay private but locked.
 */
export async function archiveGameSurfaces(
  guild: Guild,
  game: GameRoleIds & {
    id: string;
    channelId: string;
    kibThreadId?: string | null;
  },
  engine?: Pick<GameEngine, "getState" | "getStorytellerDiscordIds"> | null,
): Promise<ArchiveGameSurfacesResult> {
  let channels = 0;
  let threads = 0;
  let movedChannels = 0;

  const kib = await getKibThreadForGame(guild, game);
  const archiveCategoryId = await resolveArchiveCategoryId(guild.id);

  const notice =
    "This game has been **archived** — open for reading, locked for posting.";
  const town = await guild.channels.fetch(game.channelId).catch(() => null);
  if (town?.isTextBased() && !town.isDMBased()) {
    await town.send({ content: notice }).catch(() => undefined);
  }
  if (kib && kib.isTextBased()) {
    await kib.send({ content: notice }).catch(() => undefined);
  }

  if (await applyArchiveChannelPermissions(guild, game.channelId, game)) {
    channels++;
  }

  if (kib && isKibChannelVenue(kib) && kib.id !== game.channelId) {
    if (await applyArchiveChannelPermissions(guild, kib.id, game)) {
      channels++;
    }
  }

  if (archiveCategoryId) {
    if (await moveChannelToArchiveCategory(guild, game.channelId, archiveCategoryId)) {
      movedChannels++;
    }
    if (kib && isKibChannelVenue(kib) && kib.id !== game.channelId) {
      if (await moveChannelToArchiveCategory(guild, kib.id, archiveCategoryId)) {
        movedChannels++;
      }
    }
  }

  // Use a full Discord channel scan so threads not tracked in the DB (whispers created
  // before they were recorded, manually created threads, etc.) are also locked.
  // For the kib channel venue, scan its threads too.
  const townScan = await archiveChannelThreadsDirectly(guild, game.channelId);
  threads += townScan.threads;

  if (kib && isKibChannelVenue(kib) && kib.id !== game.channelId) {
    const kibScan = await archiveChannelThreadsDirectly(guild, kib.id);
    threads += kibScan.threads;
  }

  const kibUserIds: string[] = [];
  if (kib?.isThread()) {
    const members = await kib.members.fetch().catch(() => null);
    if (members) {
      for (const member of members.values()) kibUserIds.push(member.id);
    }
  }

  const stripped = await stripGameRolesFromMembers(guild, game, engine, kibUserIds);
  return { channels, threads, movedChannels, rolesStripped: stripped.users };
}

export type ArchivePreviewLine = {
  /** Human-readable channel/thread name */
  name: string;
  /** Discord channel mention (<#id>) */
  mention: string;
  /** What would happen */
  action: string;
};

export type ArchivePreviewResult = {
  channelLines: ArchivePreviewLine[];
  threadLines: ArchivePreviewLine[];
  roleLines?: ArchivePreviewLine[];
};

/** Dry-run list of surfaces `/st do archive` would lock (may exceed Discord's 2000-char cap). */
export function formatArchiveDryRunContent(preview: ArchivePreviewResult): string {
  const roleLines = preview.roleLines ?? [];
  const lines: string[] = [];
  if (preview.channelLines.length > 0) {
    lines.push(`**Channels (${preview.channelLines.length})**`);
    for (const channel of preview.channelLines) {
      lines.push(`• ${channel.mention}`);
    }
  }
  if (preview.threadLines.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`**Threads (${preview.threadLines.length})**`);
    for (const thread of preview.threadLines) {
      lines.push(`• ${thread.mention}`);
    }
  }
  if (roleLines.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`**Roles (${roleLines.length})**`);
    for (const role of roleLines) {
      lines.push(`• ${role.mention}`);
    }
  }
  if (lines.length === 0) {
    lines.push("Nothing found to archive in this channel.");
  }
  const roleNote =
    roleLines.length > 0 ? " ST/player/kib roles would be removed from everyone who has them." : "";
  return (
    `**Archive dry run** — no changes made. These would be locked read-only.${roleNote}\n\n` +
    `${lines.join("\n")}\n\n` +
    "Run `/st do archive` (without `dry_run`) to apply."
  );
}

/**
 * Dry-run version of archiveGameSurfaces / archiveChannelThreadsDirectly.
 * Discovers what would be changed without making any Discord API writes.
 */
export async function previewArchiveSurfaces(
  guild: Guild,
  channelId: string,
  game?: GameRoleIds & { id: string; kibThreadId?: string | null } | null,
): Promise<ArchivePreviewResult> {
  const channelLines: ArchivePreviewLine[] = [];
  const threadLines: ArchivePreviewLine[] = [];
  const roleLines: ArchivePreviewLine[] = [];

  const kib = game ? await getKibThreadForGame(guild, game) : null;
  const archiveCategoryId = await resolveArchiveCategoryId(guild.id);
  let archiveCategoryLabel: string | null = null;
  if (archiveCategoryId) {
    const category = await guild.channels.fetch(archiveCategoryId).catch(() => null);
    archiveCategoryLabel =
      category && "name" in category ? String(category.name) : archiveCategoryId;
  }

  // Channels that would get permission overwrites
  const channelIds = [channelId];
  if (kib && isKibChannelVenue(kib) && kib.id !== channelId) {
    channelIds.push(kib.id);
  }

  for (const cid of channelIds) {
    const ch = await guild.channels.fetch(cid).catch(() => null);
    if (!ch) continue;
    const name = "name" in ch ? String(ch.name) : cid;
    const parts = [
      game
        ? "@everyone: ViewChannel ✓, SendMessages ✗ — game roles: SendMessages / CreateThreads / ManageThreads ✗"
        : "threads scanned and locked (no permission overwrites — no game record)",
    ];
    if (archiveCategoryId && !ch.isThread() && "parentId" in ch) {
      if (ch.parentId === archiveCategoryId) {
        parts.push(`already in Archives category "${archiveCategoryLabel}"`);
      } else {
        parts.push(`move to Archives category "${archiveCategoryLabel}"`);
      }
    } else if (!archiveCategoryId && game) {
      parts.push("no Archives category configured (set in admin Guild settings or ARCHIVE_CATEGORY_ID)");
    }
    channelLines.push({ name, mention: `<#${cid}>`, action: parts.join(" — ") });
  }

  // Threads under town
  const townParent = await guild.channels.fetch(channelId).catch(() => null);
  if (isGameTextChannel(townParent)) {
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    if (active) {
      for (const thread of active.threads.values()) {
        if (thread.parentId !== channelId) continue;
        const vis = thread.type === ChannelType.PrivateThread ? "private" : "public";
        threadLines.push({
          name: thread.name,
          mention: `<#${thread.id}>`,
          action: thread.archived
            ? `unarchive → lock (${vis})`
            : `lock (${vis})`,
        });
      }
    }
    for (const type of ["public", "private"] as const) {
      const archived = await townParent.threads.fetchArchived({ type, limit: 100 }).catch(() => null);
      if (!archived) continue;
      for (const thread of archived.threads.values()) {
        const vis = thread.type === ChannelType.PrivateThread ? "private" : "public";
        threadLines.push({
          name: thread.name,
          mention: `<#${thread.id}>`,
          action: `unarchive → lock (${vis})`,
        });
      }
    }
  }

  // Threads under kib channel venue
  if (kib && isKibChannelVenue(kib) && kib.id !== channelId && isGameTextChannel(kib)) {
    for (const type of ["public", "private"] as const) {
      const archived = await kib.threads.fetchArchived({ type, limit: 100 }).catch(() => null);
      if (!archived) continue;
      for (const thread of archived.threads.values()) {
        const vis = thread.type === ChannelType.PrivateThread ? "private" : "public";
        threadLines.push({
          name: thread.name,
          mention: `<#${thread.id}>`,
          action: `unarchive → lock (${vis})`,
        });
      }
    }
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    if (active) {
      for (const thread of active.threads.values()) {
        if (thread.parentId !== kib.id) continue;
        const vis = thread.type === ChannelType.PrivateThread ? "private" : "public";
        threadLines.push({
          name: thread.name,
          mention: `<#${thread.id}>`,
          action: thread.archived
            ? `unarchive → lock (${vis})`
            : `lock (${vis})`,
        });
      }
    }
  }

  if (game) {
    for (const roleId of uniqueGameRoleIds(game)) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      roleLines.push({
        name: role.name,
        mention: `<@&${role.id}>`,
        action: "remove from members",
      });
    }
  }

  return { channelLines, threadLines, roleLines };
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
    // Stored IDs can be stale after role recreate — fall through to name lookup.
  }

  return getGameRoles(guild, game.channelId);
}

/** Player Discord role id for a game (DB id if still valid, else resolveGameRoles). */
export async function resolvePlayerRoleId(
  guild: Guild | null,
  game: GameRoleIds,
): Promise<string | null> {
  if (!guild) return null;

  if (game.playerRoleId) {
    const cached = guild.roles.cache.get(game.playerRoleId);
    if (cached) return cached.id;
    const fetched = await guild.roles.fetch(game.playerRoleId).catch(() => null);
    if (fetched) return fetched.id;
  }

  const roles = await resolveGameRoles(guild, game);
  return roles?.playersRole.id ?? null;
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
 * Returns false when Discord rejects the assign (permissions, unknown role, …).
 */
export async function addRoleToUser(
  guild: Guild | null,
  userId: string,
  roleId: string,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  if (!guild) return false;
  try {
    await guild.members.addRole({ user: userId, role: roleId });
    return true;
  } catch (error) {
    log("warn", "discord.role.add.failed", {
      guildId: guild.id,
      userId,
      roleId,
      ...serializeError(error),
      ...context,
    });
    void reportError("discord.role.add.failed", error, {
      guildId: guild.id,
      userId,
      roleId,
      ...context,
    });
    return false;
  }
}

export async function removeRoleFromUser(
  guild: Guild | null,
  userId: string,
  roleId: string,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  if (!guild) return false;
  try {
    await guild.members.removeRole({ user: userId, role: roleId });
    return true;
  } catch (error) {
    log("warn", "discord.role.remove.failed", {
      guildId: guild.id,
      userId,
      roleId,
      ...serializeError(error),
      ...context,
    });
    void reportError("discord.role.remove.failed", error, {
      guildId: guild.id,
      userId,
      roleId,
      ...context,
    });
    return false;
  }
}

export type TransferGamePlayerRoleResult =
  | { status: "transferred"; roleId: string }
  | { status: "missing" }
  | { status: "failed"; roleId: string; added: boolean; removed: boolean };

/**
 * Move the game player role from one Discord user to another.
 * Adds to the new user first; only removes from the old user after a successful add.
 */
export async function transferGamePlayerRole(
  guild: Guild,
  game: GameRoleIds,
  oldDiscordUserId: string,
  newDiscordUserId: string,
): Promise<TransferGamePlayerRoleResult> {
  const roleId = await resolvePlayerRoleId(guild, game);
  if (!roleId) {
    void reportError(
      "discord.role.player.missing",
      new Error("Could not resolve player role for game"),
      {
        guildId: guild.id,
        channelId: game.channelId,
        playerRoleId: game.playerRoleId ?? null,
        oldDiscordUserId,
        newDiscordUserId,
      },
    );
    return { status: "missing" };
  }

  const context = {
    channelId: game.channelId,
    oldDiscordUserId,
    newDiscordUserId,
    operation: "transferGamePlayerRole",
  };

  const added = await addRoleToUser(guild, newDiscordUserId, roleId, context);
  if (!added) {
    return { status: "failed", roleId, added: false, removed: false };
  }

  const removed = await removeRoleFromUser(guild, oldDiscordUserId, roleId, context);
  if (!removed) {
    return { status: "failed", roleId, added: true, removed: false };
  }
  return { status: "transferred", roleId };
}

export type SyncGamePlayerRolesResult = {
  roleId: string;
  seated: number;
  alreadyHad: number;
  addedUserIds: string[];
  failedUserIds: string[];
  notInGuildUserIds: string[];
  skippedFake: number;
};

/**
 * Add the game player role to every seated real player who does not already have it.
 */
export async function syncGamePlayerRoles(
  guild: Guild,
  game: GameRoleIds,
  engine: GameEngine,
): Promise<SyncGamePlayerRolesResult | null> {
  const roleId = await resolvePlayerRoleId(guild, game);
  if (!roleId) {
    void reportError(
      "discord.role.player.missing",
      new Error("Could not resolve player role for game"),
      {
        guildId: guild.id,
        channelId: game.channelId,
        playerRoleId: game.playerRoleId ?? null,
        operation: "syncGamePlayerRoles",
      },
    );
    return null;
  }

  let seated = 0;
  let alreadyHad = 0;
  const addedUserIds: string[] = [];
  const failedUserIds: string[] = [];
  const notInGuildUserIds: string[] = [];
  let skippedFake = 0;

  for (const player of engine.getState().players) {
    if (player.isFake || isFakePlayer(player.discordUserId) || player.discordUserId.startsWith("dev:")) {
      skippedFake++;
      continue;
    }
    seated++;

    const member = await fetchGuildMemberWithTimeout(guild, player.discordUserId, undefined, {
      force: true,
    });
    if (!member) {
      notInGuildUserIds.push(player.discordUserId);
      continue;
    }
    if (member.roles.cache.has(roleId)) {
      alreadyHad++;
      continue;
    }

    const ok = await addRoleToUser(guild, player.discordUserId, roleId, {
      channelId: game.channelId,
      operation: "syncGamePlayerRoles",
      playerId: player.id,
    });
    if (ok) addedUserIds.push(player.discordUserId);
    else failedUserIds.push(player.discordUserId);
  }

  return {
    roleId,
    seated,
    alreadyHad,
    addedUserIds,
    failedUserIds,
    notInGuildUserIds,
    skippedFake,
  };
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
    if (isFakePlayer(player.discordUserId) && !isDevMode()) continue;
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
  storedThreadId?: string | null,
): Promise<AnyThreadChannel | null> {
  if (storedThreadId) {
    const byId = await guild.channels.fetch(storedThreadId).catch(() => null);
    if (byId?.isThread() && byId.parentId === parentChannelId) {
      return byId;
    }
  }

  const cleanName = stPlayerThreadName(displayName);
  const legacyName = legacyPersonalPlayerThreadName(gameId, displayName);
  const index = threadIndex ?? (await loadParentThreadIndex(guild, parentChannelId));
  return index.get(legacyName) ?? index.get(cleanName) ?? null;
}

async function persistPlayerStThreadId(
  gameId: string,
  discordUserId: string,
  threadId: string,
): Promise<void> {
  await prisma.player.updateMany({
    where: { gameId, discordUserId },
    data: { stThreadId: threadId },
  });
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

  const threadName = kibThreadName(parent.name);
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
        // Only ping ST + kib — @mentioning the player role in a private thread adds
        // every player to kib (Discord thread membership), which we do not want.
        const kibPing = formatKibRolePingLine(gameRoles);
        await thread
          .send({
            content: `Kib thread ready.${kibPing.content} Use \`/st add-kib\` to grant kib access.`,
            allowedMentions: { roles: kibPing.roleIds },
          })
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
    if (gameRoles?.stRole.id) {
      await addRoleMembersToThread(guild, venue, gameRoles.stRole.id);
    }
    if (kibRoleId) {
      await addRoleMembersToThread(guild, venue, kibRoleId);
    }
  } else {
    const kibPing = formatKibRolePingLine(gameRoles);
    await venue
      .send({
        content: `Kib channel attached.${kibPing.content} Use \`/st add-kib\` to grant kib access.`,
        allowedMentions: { roles: kibPing.roleIds },
      })
      .catch(() => undefined);
  }

  return { mention: `<#${venue.id}>`, threadId: venue.id };
}

/** ST + kib role pings for kib venues (never the player role — that adds players to private kib). */
export function formatKibRolePingLine(
  gameRoles?: Pick<GameRoles, "stRole" | "spectatorRole"> | null,
): { content: string; roleIds: string[] } {
  if (!gameRoles) return { content: "", roleIds: [] };
  const roleIds = [gameRoles.stRole.id, gameRoles.spectatorRole.id].filter(Boolean);
  if (roleIds.length === 0) return { content: "", roleIds: [] };
  return {
    content: ` Roles: <@&${gameRoles.stRole.id}> / kib <@&${gameRoles.spectatorRole.id}>.`,
    roleIds,
  };
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

/** Invite engine storytellers + anyone cached with the game ST role into a private thread. */
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
 * Mass-add a Discord user to every personal player ST thread (backpacker / follower access).
 * Does not assign roles or touch whispers/kib.
 */
export async function addUserToPlayerStThreads(
  guild: Guild,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
  userId: string,
  reason = "Adding backpacker to player ST thread.",
): Promise<{ attempted: number; added: number }> {
  const threads = await listPersonalPlayerThreads(guild, game, engine, {
    includeArchived: true,
  });
  let added = 0;
  let attempted = 0;
  for (const thread of threads) {
    if (!thread.isThread()) continue;
    attempted++;
    if (thread.archived) {
      await thread.setArchived(false, reason).catch(() => undefined);
    }
    const ok = await thread.members.add(userId).then(() => true).catch(() => false);
    if (ok) added++;
  }
  return { attempted, added };
}

/**
 * Mass-remove a Discord user from every personal player ST thread.
 */
export async function removeUserFromPlayerStThreads(
  guild: Guild,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
  userId: string,
  reason = "Removing backpacker from player ST thread.",
): Promise<{ attempted: number; removed: number }> {
  const threads = await listPersonalPlayerThreads(guild, game, engine, {
    includeArchived: true,
  });
  let removed = 0;
  let attempted = 0;
  for (const thread of threads) {
    if (!thread.isThread()) continue;
    attempted++;
    if (thread.archived) {
      await thread.setArchived(false, reason).catch(() => undefined);
    }
    const ok = await thread.members.remove(userId).then(() => true).catch(() => false);
    if (ok) removed++;
  }
  return { attempted, removed };
}

/**
 * Create or reopen one player's private ST thread and invite the player + storytellers.
 */
export async function ensurePlayerStThread(
  interaction: CommandInteraction,
  game: GameRoleIds & { id: string; channelId: string },
  engine: GameEngine,
  player: { discordUserId: string; displayName: string; stThreadId?: string | null },
  options?: {
    threadIndex?: Map<string, AnyThreadChannel>;
    /** Post the “Private ST thread…” intro (default true when newly created). */
    announce?: boolean;
  },
): Promise<{ thread: AnyThreadChannel | null; created: boolean }> {
  const guild = interaction.guild;
  if (!guild) return { thread: null, created: false };
  if (isFakePlayer(player.discordUserId) && !isDevMode()) {
    return { thread: null, created: false };
  }

  let storedThreadId = player.stThreadId ?? null;
  if (!storedThreadId) {
    const row = await prisma.player.findUnique({
      where: {
        gameId_discordUserId: { gameId: game.id, discordUserId: player.discordUserId },
      },
      select: { stThreadId: true },
    });
    storedThreadId = row?.stThreadId ?? null;
  }

  const threadName = stPlayerThreadName(player.displayName);
  let thread =
    (storedThreadId && options?.threadIndex
      ? [...options.threadIndex.values()].find((candidate) => candidate.id === storedThreadId)
      : undefined) ??
    (await findPersonalPlayerThread(
      guild,
      game.channelId,
      game.id,
      player.displayName,
      options?.threadIndex,
      storedThreadId,
    ));
  let created = false;

  if (!thread) {
    log("info", "st.player-thread.create", {
      gameId: game.id,
      playerId: player.discordUserId,
      threadName,
    });
    thread = await createPersonalPlayerThread(
      interaction,
      game.id,
      game.channelId,
      player.discordUserId,
      player.displayName,
    );
    created = Boolean(thread);
    if (thread && options?.threadIndex) options.threadIndex.set(threadName, thread);
  }

  if (!thread) return { thread: null, created: false };

  if (thread.archived) {
    await thread.setArchived(false, "Reopening player ST thread.").catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  await persistPlayerStThreadId(game.id, player.discordUserId, thread.id);

  if (!isFakePlayer(player.discordUserId)) {
    await thread.members.add(player.discordUserId).catch(() => undefined);
  }
  // Always invite the acting ST (role cache is often empty without Guild Members intent).
  await thread.members.add(interaction.user.id).catch(() => undefined);
  await addStorytellersToPlayerThread(guild, thread, engine, game.stRoleId);

  // New threads already get an intro from createPersonalPlayerThread.
  const shouldAnnounce = !created && (options?.announce ?? false);
  if (shouldAnnounce) {
    const fakePlayer = isFakePlayer(player.discordUserId);
    await thread
      .send({
        content: fakePlayer
          ? `Private ST thread for **${player.displayName}** (dev bot). Only the storyteller and server admins can access this thread.\n` +
            `Day-play commands: **/player help** (nominate, vote, whisper, alias, …).`
          : `Private ST thread for <@${player.discordUserId}>. Only you, the storyteller, and server admins can access this thread.\n` +
            `Day-play commands: **/player help** (nominate, vote, whisper, alias, …).`,
        ...(fakePlayer ? {} : { allowedMentions: { users: [player.discordUserId] } }),
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
    if (isFakePlayer(player.discordUserId) && !isDevMode()) continue;

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

    const threadName = storytellerThreadName(parent.name);

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
    if (!isFakePlayer(userId)) {
      await existing.members.add(userId).catch(() => undefined);
    }
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

  const threadName = stPlayerThreadName(displayName);

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

    const fakePlayer = isFakePlayer(userId);
    if (!fakePlayer) {
      await thread.members.add(userId).catch(() => undefined);
    }
    await thread.send({
      content: fakePlayer
        ? `Hi! This is the private game thread for **${displayName}** (dev bot player).\n` +
          `Only the storyteller and server admins can see this thread.\n` +
          `Day-play commands: **/player help** (nominate, vote, whisper, alias, …).`
        : `Hi <@${userId}>! This is your private game thread for Grimkeeper.\n` +
          `Only you, the storyteller, and server admins can see this thread — do not try to invite others.\n` +
          `Day-play commands: **/player help** (nominate, vote, whisper, alias, …).`,
      ...(fakePlayer ? {} : { allowedMentions: { users: [userId] } }),
    });
    await persistPlayerStThreadId(gameId, userId, thread.id);
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
  const clean = storytellerThreadName(parentChannelName);
  if (candidate.name === clean) return true;
  if (gameId && parentChannelName) {
    return candidate.name === legacyStorytellerThreadName(parentChannelName, gameId);
  }
  if (gameId) {
    return candidate.name === legacyStorytellerThreadName(undefined, gameId);
  }
  return false;
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
      return byId;
    }
  }

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  const parentChannelName = parent && "name" in parent ? parent.name : undefined;
  const expectedNames = new Set<string>();
  const clean = storytellerThreadName(parentChannelName);
  expectedNames.add(clean);
  if (parentChannelName) {
    expectedNames.add(kibThreadName(parentChannelName));
  }
  if (options?.gameId) {
    expectedNames.add(legacyStorytellerThreadName(parentChannelName, options.gameId));
    if (parentChannelName) {
      expectedNames.add(legacyKibThreadName(parentChannelName, options.gameId));
    }
  }

  const matchesName = (candidate: { parentId: string | null; name: string }) =>
    candidate.parentId === parentChannelId && expectedNames.has(candidate.name);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread =
    active?.threads.find((candidate) => candidate.name === clean && matchesName(candidate)) ??
    active?.threads.find((candidate) => matchesName(candidate));
  if (activeThread) return activeThread;

  if (!isGameTextChannel(parent)) return null;

  const archived = await parent.threads.fetchArchived({ type: "private" }).catch(() => null);
  return (
    archived?.threads.find((candidate) => candidate.name === clean && matchesName(candidate)) ??
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
  game: { id: string; channelId: string; votingThreadId?: string | null },
  engine: GameEngine,
): Promise<DayDiscussionChannel | null> {
  const state = engine.getState();

  let votingThreadId = game.votingThreadId;
  if (votingThreadId === undefined) {
    const row = await prisma.game.findUnique({
      where: { id: game.id },
      select: { votingThreadId: true },
    });
    votingThreadId = row?.votingThreadId ?? null;
  }

  // Admin "Voting thread ID" is authoritative when it points at a thread under town.
  if (votingThreadId) {
    const byId = await guild.channels.fetch(votingThreadId).catch(() => null);
    if (byId?.isThread() && byId.parentId === game.channelId) {
      return byId as DayDiscussionChannel;
    }
  }

  const dayThreadId = state.day?.discordThreadId;
  if (dayThreadId) {
    const thread = await guild.channels.fetch(dayThreadId).catch(() => null);
    if (thread?.isThread() && thread.parentId === game.channelId) {
      if (state.townMode) {
        if (isTownVotingThreadName(thread.name, game.id)) {
          return thread as DayDiscussionChannel;
        }
      } else {
        const short = shortGameId(game.id);
        if (!thread.name.includes(" · ") || thread.name.includes(short)) {
          return thread as DayDiscussionChannel;
        }
      }
    }
  }

  if (state.townMode) {
    const byName = await findTownVoteThread(guild, game.channelId, game.id, votingThreadId ?? null);
    return (byName as DayDiscussionChannel) ?? null;
  }

  return null;
}

/**
 * Resolve Town Voting, creating/reopening it on day if missing so ST kib actions can still post.
 */
export async function ensureVotingChannel(
  guild: Guild,
  game: GameRoleIds & {
    id: string;
    channelId: string;
    votingThreadId?: string | null;
  },
  engine: GameEngine,
): Promise<{ channel: DayDiscussionChannel | null; game: typeof game }> {
  let voting = await resolveVotingChannel(guild, game, engine);
  if (!voting && engine.getState().townMode && engine.getState().phase === "day") {
    const reopened = await createTownVoteThread(guild, game, engine);
    if (reopened) {
      game = { ...game, votingThreadId: reopened.id };
      voting = reopened as DayDiscussionChannel;
    }
  }
  if (voting) {
    await ensureDiscussionChannelSendable(voting, "Ensuring Town Voting is open for nominations.");
  }
  return { channel: voting, game };
}

export async function listPersonalPlayerThreads(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
  options?: { includeArchived?: boolean },
): Promise<DayDiscussionChannel[]> {
  const rows = await prisma.player.findMany({
    where: { gameId: game.id },
    select: { discordUserId: true, stThreadId: true, displayName: true },
  });
  const stThreadByUser = new Map(rows.map((row) => [row.discordUserId, row]));
  const threadIndex = await loadParentThreadIndex(guild, game.channelId);
  const threads: DayDiscussionChannel[] = [];
  for (const player of engine.getState().players) {
    if (isFakePlayer(player.discordUserId) && !isDevMode()) continue;
    const stored = stThreadByUser.get(player.discordUserId);
    const thread = await findPersonalPlayerThread(
      guild,
      game.channelId,
      game.id,
      player.displayName,
      threadIndex,
      stored?.stThreadId,
    );
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
    votingThreadId?: string | null;
  },
  engine: GameEngine,
  nominationId: string,
): Promise<{ voteThread: boolean; error?: string }> {
  const ensured = await ensureVotingChannel(guild, game, engine);
  game = ensured.game;
  const voting = ensured.channel;

  let voteThread = false;
  let error: string | undefined;
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
    const posted = await postNominationToChannelDetailed(engine, game.id, voting, nominationId, {
      pingRoleId: roles?.playersRole.id ?? pingRoleId,
    });
    voteThread = Boolean(posted.message);
    error = posted.error;
  } else {
    error = "Could not resolve Town Voting thread.";
    log("warn", "nomination.embed.noVotingChannel", {
      gameId: game.id,
      nominationId,
      phase: engine.getState().phase,
      dayThreadId: engine.getState().day?.discordThreadId ?? null,
      votingThreadId: game.votingThreadId ?? null,
    });
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

  return { voteThread, error };
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
  game: GameRoleIds & { id: string; channelId: string; votingThreadId?: string | null },
  _engine: GameEngine,
): Promise<AnyThreadChannel | null> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const threadName = townVoteThreadName();
  const playerStThreadIds = new Set(
    (
      await prisma.player.findMany({
        where: { gameId: game.id, stThreadId: { not: null } },
        select: { stThreadId: true },
      })
    )
      .map((row) => row.stThreadId)
      .filter((id): id is string => Boolean(id)),
  );

  let thread = await findTownVoteThread(guild, game.channelId, game.id, game.votingThreadId);

  // Never reuse a personal ST thread as Town Voting. Admin-configured votingThreadId
  // is kept even if the Discord name is not exactly "Town Voting".
  if (thread && playerStThreadIds.has(thread.id)) {
    if (game.votingThreadId === thread.id) {
      await prisma.game
        .update({
          where: { id: game.id },
          data: { votingThreadId: null },
        })
        .catch(() => undefined);
    }
    thread = null;
  } else if (
    thread &&
    game.votingThreadId !== thread.id &&
    !isTownVotingThreadName(thread.name, game.id)
  ) {
    // Name-search fallback hit something that isn't Town Voting — ignore it.
    thread = null;
  }

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
        "After setup-town the game is in **Setup**. Night 1 starts when the storyteller advances the phase.",
        "You can vote on **any open nomination** with the **Vote** button.",
        "Prefer a private ballot? Use `/privatevote` (ST sees it on the kib vote tracker).",
        "Players: `/nominate` / `/defend` / `/vote` / `/privatevote` / `/roster` / `/whisper`.",
        "Storyteller: use the kib **control panel**.",
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
    // Only rename threads that are already Town Voting (legacy `· shortId` names).
    await thread.setName(threadName, "Restore Town Voting thread name").catch(() => undefined);
  }

  if (thread.archived) {
    await thread.setArchived(false, "Town setup; reopening vote thread.").catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  await prisma.game.update({
    where: { id: game.id },
    data: { votingThreadId: thread.id },
  });

  return thread;
}

export function isTownVotingThreadName(name: string, gameId: string): boolean {
  if (name === townVoteThreadName()) return true;
  if (name === legacyTownVoteThreadName(gameId)) return true;
  // Legacy / slightly edited names must still say Town Voting and carry this game’s suffix.
  return name.includes("Town Voting") && name.includes(legacyGameNameSuffix(gameId));
}

export async function findTownVoteThread(
  guild: Guild,
  parentChannelId: string,
  gameId: string,
  storedThreadId?: string | null,
): Promise<AnyThreadChannel | null> {
  let votingThreadId = storedThreadId;
  if (votingThreadId === undefined) {
    const row = await prisma.game.findUnique({
      where: { id: gameId },
      select: { votingThreadId: true },
    });
    votingThreadId = row?.votingThreadId ?? null;
  }

  // Stored/admin ID wins when the thread still lives under the town channel.
  if (votingThreadId) {
    const byId = await guild.channels.fetch(votingThreadId).catch(() => null);
    if (byId?.isThread() && byId.parentId === parentChannelId) {
      return byId;
    }
  }

  const matchesVoteThread = (name: string) => isTownVotingThreadName(name, gameId);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) => candidate.parentId === parentChannelId && matchesVoteThread(candidate.name),
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  // Prefer public (current); still find legacy private Town Voting threads.
  for (const type of ["public", "private"] as const) {
    const archived = await parent.threads.fetchArchived({ type }).catch(() => null);
    const match = archived?.threads.find((candidate) => matchesVoteThread(candidate.name));
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
          ? `It is **Night ${state.nightNumber}**. Nominations are closed until the next day.`
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
  stRoleId?: string | null,
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
    if (stRoleId) {
      await addRoleMembersToThread(guild, thread, stRoleId);
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

  const chunks =
    typeof payload.content === "string" ? splitDiscordContent(payload.content) : [];
  const first =
    chunks.length > 0 ? { ...payload, content: chunks[0] } : payload;

  await withAcknowledgedFallback(
    buildInteractionResponseAttempts(interaction, first, { allowReply: false }),
  );

  for (const extra of chunks.slice(1)) {
    try {
      await interaction.followUp({
        content: extra,
        ...(payload.flags != null ? { flags: payload.flags } : {}),
      });
    } catch (error) {
      if (isUnknownInteractionError(error)) return;
      if (!isRecoverableInteractionResponseError(error)) throw error;
    }
  }
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
function deleteGame(id: string) {
  return prisma.game.delete({
    where: { id },
  });
}


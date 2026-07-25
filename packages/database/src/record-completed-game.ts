import { randomUUID } from "node:crypto";
import {
  GameEngine,
  GameEventType,
  getStorytellerDiscordIds,
  type GameEvent,
} from "@grimkeeper/engine";

import { prisma } from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";
import { teamFromRoleId } from "./sync-projection.js";

/** Admin-recorded completed games — never post to Discord. */
export const GAME_SOURCE_STATS_ONLY = "stats_only";

/** Sentinel channel id when no real Discord channel exists. */
export const STATS_ONLY_CHANNEL_ID = "stats-only";

export type RecordCompletedGamePlayerInput = {
  discordUserId: string;
  displayName: string;
  seat?: number | null;
  roleId?: string | null;
  /** good | evil | traveler; derived from role when omitted. */
  team?: string | null;
};

export type RecordCompletedGameInput = {
  guildId: string;
  /** Optional; defaults to {@link STATS_ONLY_CHANNEL_ID}. */
  channelId?: string | null;
  winner: "good" | "evil";
  startedAt: Date;
  endedAt: Date;
  /** Primary storyteller Discord user id (GameCreated.storytellerId). */
  storytellerId: string;
  /** Co-ST Discord user ids (StorytellerPromoted), excluding primary. */
  coStorytellerIds?: string[];
  players: RecordCompletedGamePlayerInput[];
};

export type RecordCompletedGameResult = {
  gameId: string;
};

function assertValidInput(input: RecordCompletedGameInput): void {
  const guildId = input.guildId.trim();
  if (!guildId) throw new Error("Guild ID is required.");
  if (input.winner !== "good" && input.winner !== "evil") {
    throw new Error('Winner must be "good" or "evil".');
  }
  if (Number.isNaN(input.startedAt.getTime())) {
    throw new Error("Started at must be a valid date/time.");
  }
  if (Number.isNaN(input.endedAt.getTime())) {
    throw new Error("Ended at must be a valid date/time.");
  }
  if (input.endedAt.getTime() < input.startedAt.getTime()) {
    throw new Error("Ended at must be on or after started at.");
  }
  const storytellerId = input.storytellerId.trim();
  if (!storytellerId) throw new Error("Primary storyteller Discord ID is required.");
  if (input.players.length === 0) {
    throw new Error("At least one player is required.");
  }
  const seen = new Set<string>();
  for (const player of input.players) {
    const discordUserId = player.discordUserId.trim();
    const displayName = player.displayName.trim();
    if (!discordUserId || !displayName) {
      throw new Error("Each player needs a Discord user ID and display name.");
    }
    if (seen.has(discordUserId)) {
      throw new Error(`Duplicate player Discord ID: ${discordUserId}`);
    }
    seen.add(discordUserId);
    if (player.team != null && player.team !== "") {
      const team = player.team.trim().toLowerCase();
      if (team !== "good" && team !== "evil" && team !== "traveler") {
        throw new Error(`Invalid team "${player.team}". Use good, evil, or traveler.`);
      }
    }
  }
}

/**
 * Build synthetic engine events for a stats-only completed game.
 * ST storage matches live games: GameCreated.storytellerId + StorytellerPromoted.
 */
export function buildRecordedGameEvents(
  gameId: string,
  input: RecordCompletedGameInput,
  playerIds: string[],
): GameEvent[] {
  assertValidInput(input);
  if (playerIds.length !== input.players.length) {
    throw new Error("playerIds length must match players.");
  }

  const guildId = input.guildId.trim();
  const channelId = (input.channelId?.trim() || STATS_ONLY_CHANNEL_ID);
  const storytellerId = input.storytellerId.trim();
  const startedAt = input.startedAt.toISOString();
  const endedAt = input.endedAt.toISOString();

  const coStorytellerIds = [
    ...new Set(
      (input.coStorytellerIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id && id !== storytellerId),
    ),
  ];

  const events: GameEvent[] = [
    {
      type: GameEventType.GameCreated,
      gameId,
      guildId,
      channelId,
      storytellerId,
      script: null,
      timestamp: startedAt,
    },
  ];

  for (const discordUserId of coStorytellerIds) {
    events.push({
      type: GameEventType.StorytellerPromoted,
      gameId,
      discordUserId,
      timestamp: startedAt,
    });
  }

  input.players.forEach((player, index) => {
    const playerId = playerIds[index]!;
    events.push({
      type: GameEventType.PlayerAdded,
      gameId,
      playerId,
      discordUserId: player.discordUserId.trim(),
      displayName: player.displayName.trim(),
      timestamp: startedAt,
    });
    if (player.seat != null && Number.isInteger(player.seat) && player.seat >= 1) {
      events.push({
        type: GameEventType.SeatPicked,
        gameId,
        playerId,
        seat: player.seat,
        timestamp: startedAt,
      });
    }
    const roleId = player.roleId?.trim();
    if (roleId) {
      events.push({
        type: GameEventType.RoleAssigned,
        gameId,
        playerId,
        roleId,
        timestamp: startedAt,
      });
    }
  });

  events.push({
    type: GameEventType.GameEnded,
    gameId,
    winner: input.winner,
    reason: "Recorded completed game (stats only)",
    timestamp: endedAt,
  });

  return events;
}

/** Replay events and return storyteller Discord ids (primary first, then co-STs). */
export function storytellerIdsFromEvents(gameId: string, events: GameEvent[]): string[] {
  const engine = GameEngine.fromEvents(gameId, events);
  return getStorytellerDiscordIds(engine.getState());
}

/**
 * Create an ended game for statistics only: projection players + engine events for ST/co-ST.
 * Does not create Discord threads, roles, or posts.
 */
export async function recordCompletedGame(
  input: RecordCompletedGameInput,
): Promise<RecordCompletedGameResult> {
  assertValidInput(input);

  const gameId = randomUUID();
  const channelId = input.channelId?.trim() || STATS_ONLY_CHANNEL_ID;
  const playerRows = input.players.map((player) => {
    const roleId = player.roleId?.trim() || null;
    const team =
      (player.team?.trim().toLowerCase() || null) ?? teamFromRoleId(roleId);
    return {
      id: randomUUID(),
      discordUserId: player.discordUserId.trim(),
      displayName: player.displayName.trim(),
      seat:
        player.seat != null && Number.isInteger(player.seat) && player.seat >= 1
          ? player.seat
          : null,
      roleId,
      team,
      alive: true,
      ghostVoteUsed: false,
    };
  });

  const events = buildRecordedGameEvents(
    gameId,
    input,
    playerRows.map((row) => row.id),
  );

  await prisma.$transaction(async (tx) => {
    await tx.game.create({
      data: {
        id: gameId,
        guildId: input.guildId.trim(),
        channelId,
        phase: "ended",
        winner: input.winner,
        source: GAME_SOURCE_STATS_ONLY,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        players: {
          create: playerRows.map((row) => ({
            id: row.id,
            discordUserId: row.discordUserId,
            displayName: row.displayName,
            seat: row.seat,
            roleId: row.roleId,
            team: row.team,
            alive: row.alive,
            ghostVoteUsed: row.ghostVoteUsed,
          })),
        },
      },
    });

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i]!;
      await tx.gameEvent.create({
        data: {
          gameId,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          seq: i + 1,
        },
      });
    }
  });

  return { gameId };
}

export function isStatsOnlyGame(source: string | null | undefined): boolean {
  return source === GAME_SOURCE_STATS_ONLY;
}

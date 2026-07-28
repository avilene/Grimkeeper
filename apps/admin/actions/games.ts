"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isStatsOnlyGame,
  recordCompletedGame,
  requestDiscordKibNomsRepost,
  requestDiscordNomsRefresh,
  requestDiscordPingMissing,
  STATS_ONLY_CHANNEL_ID,
} from "@grimkeeper/database";
import { getBotcRole } from "@grimkeeper/engine";

import type { SaveResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import {
  parseLocalDateTime,
  parseOptionalLocalDateTime,
  parseTimezoneOffsetMinutes,
} from "@/lib/datetime";
import { emptyToNull, parseOptionalInt } from "@/lib/utils";
import { captureAdminException } from "@/lib/sentry";
import { requireAdmin, requireGameAccess } from "@/lib/session";

export type { SaveResult };

const GAME_PHASES = new Set(["lobby", "setup", "night", "day", "ended"]);
const PLAYER_TEAMS = new Set(["good", "evil", "traveler"]);
const WINNERS = new Set(["good", "evil"]);

function parseGamePhase(value: FormDataEntryValue | null): string {
  const phase = String(value ?? "").trim().toLowerCase() || "lobby";
  if (!GAME_PHASES.has(phase)) {
    throw new Error(`Invalid phase "${phase}". Use lobby, setup, night, day, or ended.`);
  }
  return phase;
}

function parseWinner(value: FormDataEntryValue | null, phase: string): string | null {
  if (phase !== "ended") return null;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (!WINNERS.has(raw)) {
    throw new Error(`Invalid winner "${raw}". Use good or evil.`);
  }
  return raw;
}

function parsePlayerTeam(value: FormDataEntryValue | null): string | null {
  const team = String(value ?? "").trim().toLowerCase();
  if (!team) return null;
  if (!PLAYER_TEAMS.has(team)) {
    throw new Error(`Invalid team "${team}". Use good, evil, or traveler.`);
  }
  return team;
}

function teamFromRoleId(roleId: string | null): string | null {
  if (!roleId) return null;
  const role = getBotcRole(roleId);
  if (!role) return null;
  if (role.team === "traveler") return "traveler";
  if (role.team === "minion" || role.team === "demon") return "evil";
  return "good";
}

/** Admin-only: create an ended game for stats (no Discord posts/threads/roles). */
export async function recordCompletedGameAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
      formData.get("timezoneOffsetMinutes"),
    );
    const guildId = String(formData.get("guildId") ?? "").trim();
    const channelId =
      String(formData.get("channelId") ?? "").trim() || STATS_ONLY_CHANNEL_ID;
    const winnerRaw = String(formData.get("winner") ?? "").trim().toLowerCase();
    if (winnerRaw !== "good" && winnerRaw !== "evil") {
      return { ok: false, message: 'Winner must be "good" or "evil".' };
    }
    const startedAt = parseLocalDateTime(
      formData.get("startedAt"),
      timezoneOffsetMinutes,
      "Started at",
    );
    const endedAt = parseLocalDateTime(
      formData.get("endedAt"),
      timezoneOffsetMinutes,
      "Ended at",
    );
    const storytellerId = String(formData.get("storytellerId") ?? "").trim();
    const coStorytellerIds = String(formData.get("coStorytellerIds") ?? "")
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);

    const discordUserIds = formData.getAll("playerDiscordUserId").map(String);
    const displayNames = formData.getAll("playerDisplayName").map(String);
    const seats = formData.getAll("playerSeat").map(String);
    const roleIds = formData.getAll("playerRoleId").map(String);
    const teams = formData.getAll("playerTeam").map(String);

    if (discordUserIds.length === 0) {
      return { ok: false, message: "Add at least one player." };
    }
    if (
      displayNames.length !== discordUserIds.length ||
      seats.length !== discordUserIds.length ||
      roleIds.length !== discordUserIds.length ||
      teams.length !== discordUserIds.length
    ) {
      return { ok: false, message: "Player fields are incomplete." };
    }

    const players = discordUserIds.map((discordUserId, index) => ({
      discordUserId: discordUserId.trim(),
      displayName: displayNames[index]!.trim(),
      seat: parseOptionalInt(seats[index] || null),
      roleId: emptyToNull(roleIds[index] ?? null),
      team: parsePlayerTeam(teams[index] ?? null),
    }));

    const { gameId } = await recordCompletedGame({
      guildId,
      channelId,
      winner: winnerRaw,
      startedAt,
      endedAt,
      storytellerId,
      coStorytellerIds,
      players,
    });

    revalidatePath("/games");
    redirect(`/games/${gameId}`);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    captureAdminException(err, { action: "recordCompletedGameAction" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveGame(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
      formData.get("timezoneOffsetMinutes"),
    );
    const phase = parseGamePhase(formData.get("phase"));
    const winner = parseWinner(formData.get("winner"), phase);
    await prisma.game.update({
      where: { id: gameId },
      data: {
        phase,
        winner: phase === "ended" ? winner : null,
        dayNumber: Number(formData.get("dayNumber") ?? 0),
        nightNumber: Number(formData.get("nightNumber") ?? 0),
        guildId: String(formData.get("guildId") ?? "").trim(),
        channelId: String(formData.get("channelId") ?? "").trim(),
        startedAt: parseOptionalLocalDateTime(
          formData.get("startedAt"),
          timezoneOffsetMinutes,
          "Started at",
        ),
        endedAt: parseOptionalLocalDateTime(
          formData.get("endedAt"),
          timezoneOffsetMinutes,
          "Ended at",
        ),
        stRoleId: emptyToNull(formData.get("stRoleId")),
        playerRoleId: emptyToNull(formData.get("playerRoleId")),
        kibRoleId: emptyToNull(formData.get("kibRoleId")),
        kibThreadId: emptyToNull(formData.get("kibThreadId")),
        logThreadId: emptyToNull(formData.get("logThreadId")),
        whisperDeclThreadId: emptyToNull(formData.get("whisperDeclThreadId")),
        claimsThreadId: emptyToNull(formData.get("claimsThreadId")),
        rulesThreadId: emptyToNull(formData.get("rulesThreadId")),
        votingThreadId: emptyToNull(formData.get("votingThreadId")),
      },
    });
    revalidatePath("/games");
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Game saved." };
  } catch (err) {
    captureAdminException(err, { action: "saveGame" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGame(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    const confirm = String(formData.get("confirm") ?? "").trim();
    if (confirm !== "DELETE") {
      return { ok: false, message: 'Type DELETE to confirm game deletion.' };
    }
    await prisma.game.delete({ where: { id: gameId } });
    revalidatePath("/games");
    redirect("/games");
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    captureAdminException(err, { action: "deleteGame" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function savePlayers(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const playerIds = formData.getAll("playerId").map(String);
    if (playerIds.length === 0) {
      return { ok: false, message: "No players to save." };
    }

    const belonging = await prisma.player.findMany({
      where: { gameId, id: { in: playerIds } },
      select: { id: true },
    });
    const allowed = new Set(belonging.map((row) => row.id));
    if (allowed.size !== playerIds.length) {
      return { ok: false, message: "One or more players do not belong to this game." };
    }

    await prisma.$transaction(
      playerIds.map((playerId) => {
        const roleId = emptyToNull(formData.get(`roleId_${playerId}`));
        const team =
          parsePlayerTeam(formData.get(`team_${playerId}`)) ?? teamFromRoleId(roleId);
        return prisma.player.update({
          where: { id: playerId },
          data: {
            displayName: String(formData.get(`displayName_${playerId}`) ?? "").trim(),
            discordUserId: String(formData.get(`discordUserId_${playerId}`) ?? "").trim(),
            seat: parseOptionalInt(formData.get(`seat_${playerId}`)),
            roleId,
            team,
            alive: formData.get(`alive_${playerId}`) === "on",
            ghostVoteUsed: formData.get(`ghostVoteUsed_${playerId}`) === "on",
          },
        });
      }),
    );

    revalidatePath("/games");
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: `Saved ${playerIds.length} player${playerIds.length === 1 ? "" : "s"}.` };
  } catch (err) {
    captureAdminException(err, { action: "savePlayers" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function addPlayer(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const displayName = String(formData.get("displayName") ?? "").trim();
    const discordUserId = String(formData.get("discordUserId") ?? "").trim();
    if (!displayName || !discordUserId) {
      return { ok: false, message: "Display name and Discord user ID are required." };
    }
    const roleId = emptyToNull(formData.get("roleId"));
    const team = parsePlayerTeam(formData.get("team")) ?? teamFromRoleId(roleId);
    await prisma.player.create({
      data: {
        gameId,
        displayName,
        discordUserId,
        seat: parseOptionalInt(formData.get("seat")),
        roleId,
        team,
        alive: formData.get("alive") === "on",
        ghostVoteUsed: formData.get("ghostVoteUsed") === "on",
      },
    });
    revalidatePath("/games");
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Player added." };
  } catch (err) {
    captureAdminException(err, { action: "addPlayer" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deletePlayer(
  gameId: string,
  playerId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const result = await prisma.player.deleteMany({
      where: { id: playerId, gameId },
    });
    if (result.count === 0) {
      return { ok: false, message: "Player not found on this game." };
    }
    revalidatePath("/games");
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Player deleted." };
  } catch (err) {
    captureAdminException(err, { action: "deletePlayer" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveGameDay(
  gameId: string,
  dayId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
      formData.get("timezoneOffsetMinutes"),
    );
    const dayNumber = Number(formData.get("dayNumber") ?? 0);
    if (!Number.isInteger(dayNumber) || dayNumber < 1) {
      return { ok: false, message: "Day number must be a positive integer." };
    }
    const data = {
      dayNumber,
      discordThreadId: emptyToNull(formData.get("discordThreadId")),
      nominationsOpen: formData.get("nominationsOpen") === "on",
      voteVisibility: String(formData.get("voteVisibility") ?? "public").trim() || "public",
      executionUsed: formData.get("executionUsed") === "on",
      nominationsPausedUntil: parseOptionalLocalDateTime(
        formData.get("nominationsPausedUntil"),
        timezoneOffsetMinutes,
        "Paused-until datetime",
      ),
    };

    if (dayId) {
      await prisma.gameDay.updateMany({
        where: { id: dayId, gameId },
        data,
      });
    } else {
      await prisma.gameDay.create({
        data: { gameId, ...data },
      });
    }
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: dayId ? "Day saved." : "Day created." };
  } catch (err) {
    captureAdminException(err, { action: "saveGameDay" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGameDay(
  gameId: string,
  dayId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const result = await prisma.gameDay.deleteMany({ where: { id: dayId, gameId } });
    if (result.count === 0) {
      return { ok: false, message: "Day not found on this game." };
    }
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Day deleted." };
  } catch (err) {
    captureAdminException(err, { action: "deleteGameDay" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const NOMINATION_STATUSES = new Set([
  "open",
  "resolved_pass",
  "resolved_fail",
  "executed",
]);
const VOTE_CHOICES = new Set(["yes", "no", "conditional"]);

async function assertGameDay(gameId: string, gameDayId: string) {
  const day = await prisma.gameDay.findFirst({
    where: { id: gameDayId, gameId },
    select: { id: true },
  });
  if (!day) throw new Error("Game day not found on this game.");
  return day;
}

async function assertPlayersOnGame(gameId: string, playerIds: string[]) {
  const unique = [...new Set(playerIds.filter(Boolean))];
  if (unique.length === 0) return;
  const found = await prisma.player.findMany({
    where: { gameId, id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new Error("One or more players do not belong to this game.");
  }
}

export async function saveNomination(
  gameId: string,
  nominationId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
      formData.get("timezoneOffsetMinutes"),
    );
    const gameDayId = String(formData.get("gameDayId") ?? "").trim();
    await assertGameDay(gameId, gameDayId);

    const nominatorId = String(formData.get("nominatorId") ?? "").trim();
    const nomineeId = String(formData.get("nomineeId") ?? "").trim();
    const accusation = String(formData.get("accusation") ?? "").trim();
    const defense = emptyToNull(formData.get("defense"));
    const status = String(formData.get("status") ?? "open").trim();
    const order = Number(formData.get("order") ?? 1);
    let voteDeadlineAt: Date | null = null;
    try {
      voteDeadlineAt = parseOptionalLocalDateTime(
        formData.get("voteDeadlineAt"),
        timezoneOffsetMinutes,
        "Vote deadline",
      );
    } catch {
      return { ok: false, message: "Vote deadline must be a valid date/time." };
    }

    if (!nominatorId || !nomineeId) {
      return { ok: false, message: "Nominator and nominee are required." };
    }
    if (!accusation) {
      return { ok: false, message: "Accusation is required." };
    }
    if (!NOMINATION_STATUSES.has(status)) {
      return { ok: false, message: `Invalid status "${status}".` };
    }
    if (!Number.isInteger(order) || order < 1) {
      return { ok: false, message: "Order must be a positive integer." };
    }
    await assertPlayersOnGame(gameId, [nominatorId, nomineeId]);

    if (nominationId) {
      const existing = await prisma.nomination.findFirst({
        where: { id: nominationId, gameDay: { gameId } },
        select: { id: true },
      });
      if (!existing) return { ok: false, message: "Nomination not found on this game." };
      await prisma.nomination.update({
        where: { id: nominationId },
        data: {
          gameDayId,
          nominatorId,
          nomineeId,
          accusation,
          defense,
          status,
          order,
          voteDeadlineAt,
        },
      });
    } else {
      await prisma.nomination.create({
        data: {
          id: randomUUID(),
          gameDayId,
          nominatorId,
          nomineeId,
          accusation,
          defense,
          status,
          order,
          voteDeadlineAt:
            voteDeadlineAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: nominationId ? "Nomination saved." : "Nomination created." };
  } catch (err) {
    captureAdminException(err, { action: "saveNomination" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteNomination(
  gameId: string,
  nominationId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const result = await prisma.nomination.deleteMany({
      where: { id: nominationId, gameDay: { gameId } },
    });
    if (result.count === 0) {
      return { ok: false, message: "Nomination not found on this game." };
    }
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Nomination deleted." };
  } catch (err) {
    captureAdminException(err, { action: "deleteNomination" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function optionalVoteChoice(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return value;
}

export async function saveVote(
  gameId: string,
  voteId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const nominationId = String(formData.get("nominationId") ?? "").trim();
    const voterId = String(formData.get("voterId") ?? "").trim();
    const choice = optionalVoteChoice(formData.get("choice"));
    const reason = emptyToNull(formData.get("reason"));
    const privateChoice = optionalVoteChoice(formData.get("privateChoice"));
    const privateReason = emptyToNull(formData.get("privateReason"));

    if (!nominationId || !voterId) {
      return { ok: false, message: "Nomination and voter are required." };
    }
    if (choice && !VOTE_CHOICES.has(choice)) {
      return { ok: false, message: `Invalid public choice "${choice}". Use yes, no, or conditional.` };
    }
    if (privateChoice && !VOTE_CHOICES.has(privateChoice)) {
      return {
        ok: false,
        message: `Invalid private choice "${privateChoice}". Use yes, no, or conditional.`,
      };
    }
    if (!choice && !privateChoice) {
      return { ok: false, message: "Set a public and/or private ballot." };
    }

    const nomination = await prisma.nomination.findFirst({
      where: { id: nominationId, gameDay: { gameId } },
      select: { id: true, gameDayId: true },
    });
    if (!nomination) return { ok: false, message: "Nomination not found on this game." };
    await assertPlayersOnGame(gameId, [voterId]);

    const ballotData = {
      nominationId,
      voterId,
      choice,
      reason,
      privateChoice,
      privateReason,
      gameDayId: nomination.gameDayId,
    };

    if (voteId) {
      const existing = await prisma.vote.findFirst({
        where: { id: voteId, gameDay: { gameId } },
        select: { id: true },
      });
      if (!existing) return { ok: false, message: "Vote not found on this game." };
      await prisma.vote.update({
        where: { id: voteId },
        data: ballotData,
      });
    } else {
      // Pending roster rows create on first save; upsert if the voter already has a row.
      await prisma.vote.upsert({
        where: { nominationId_voterId: { nominationId, voterId } },
        create: ballotData,
        update: ballotData,
      });
    }

    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: voteId ? "Vote saved." : "Vote set." };
  } catch (err) {
    captureAdminException(err, { action: "saveVote" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteVote(
  gameId: string,
  voteId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const result = await prisma.vote.deleteMany({
      where: { id: voteId, gameDay: { gameId } },
    });
    if (result.count === 0) {
      return { ok: false, message: "Vote not found on this game." };
    }
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Vote deleted." };
  } catch (err) {
    captureAdminException(err, { action: "deleteVote" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Ask the bot to push nomination/vote projection state to Discord (polled within ~30s). */
export async function requestNomsDiscordRefresh(
  gameId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true, phase: true, source: true },
    });
    if (!game) return { ok: false, message: "Game not found." };
    if (isStatsOnlyGame(game.source)) {
      return { ok: false, message: "Stats-only games cannot push nominations to Discord." };
    }
    await requestDiscordNomsRefresh(gameId);
    revalidatePath(`/games/${gameId}`);
    return {
      ok: true,
      message:
        "Discord refresh queued. The bot will post missing nominations and update embeds within about 30 seconds (or run /st refresh-noms now).",
    };
  } catch (err) {
    captureAdminException(err, { action: "requestNomsDiscordRefresh" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Force-fail every open nomination on a game day, then queue Discord refresh. */
export async function failOpenNominationsForDay(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const gameDayId = String(formData.get("gameDayId") ?? "").trim();
    await assertGameDay(gameId, gameDayId);
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { source: true },
    });
    if (!game) return { ok: false, message: "Game not found." };

    const result = await prisma.nomination.updateMany({
      where: { gameDayId, status: "open" },
      data: { status: "resolved_fail" },
    });
    if (result.count === 0) {
      return { ok: false, message: "No open nominations on that day." };
    }
    if (!isStatsOnlyGame(game.source)) {
      await requestDiscordNomsRefresh(gameId);
    }
    revalidatePath(`/games/${gameId}`);
    return {
      ok: true,
      message: `Failed ${result.count} open nomination${result.count === 1 ? "" : "s"}.${
        isStatsOnlyGame(game.source) ? "" : " Discord refresh queued."
      }`,
    };
  } catch (err) {
    captureAdminException(err, { action: "failOpenNominationsForDay" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Extend every nomination deadline on a day by X hours, then queue Discord refresh. */
export async function extendNominationsForDay(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const gameDayId = String(formData.get("gameDayId") ?? "").trim();
    await assertGameDay(gameId, gameDayId);
    const hours = Number(formData.get("hours"));
    if (!Number.isFinite(hours) || hours <= 0) {
      return { ok: false, message: "Hours must be a positive number." };
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { source: true },
    });
    if (!game) return { ok: false, message: "Game not found." };

    const nominations = await prisma.nomination.findMany({
      where: { gameDayId },
      select: { id: true, voteDeadlineAt: true },
    });
    if (nominations.length === 0) {
      return { ok: false, message: "No nominations on that day." };
    }

    const nowMs = Date.now();
    const deltaMs = hours * 3_600_000;
    await prisma.$transaction(
      nominations.map((nomination) => {
        const oldMs = nomination.voteDeadlineAt?.getTime() ?? NaN;
        // Add hours to the existing deadline (even if past). Missing deadline → from now.
        const baseMs = Number.isFinite(oldMs) ? oldMs : nowMs;
        return prisma.nomination.update({
          where: { id: nomination.id },
          data: { voteDeadlineAt: new Date(baseMs + deltaMs) },
        });
      }),
    );

    if (!isStatsOnlyGame(game.source)) {
      await requestDiscordNomsRefresh(gameId);
    }
    revalidatePath(`/games/${gameId}`);
    return {
      ok: true,
      message: `Extended ${nominations.length} nomination deadline${nominations.length === 1 ? "" : "s"} by ${hours} hour${hours === 1 ? "" : "s"}.${
        isStatsOnlyGame(game.source) ? "" : " Discord refresh queued."
      }`,
    };
  } catch (err) {
    captureAdminException(err, { action: "extendNominationsForDay" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Queue kib delete+repost of open nomination embeds. */
export async function requestKibNomsRepost(
  gameId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true, source: true },
    });
    if (!game) return { ok: false, message: "Game not found." };
    if (isStatsOnlyGame(game.source)) {
      return { ok: false, message: "Stats-only games cannot push nominations to Discord." };
    }
    await requestDiscordKibNomsRepost(gameId);
    revalidatePath(`/games/${gameId}`);
    return {
      ok: true,
      message:
        "Kib nom repost queued. The bot will refresh open nomination copies in kib within about 30 seconds (or run /st repost-kib-noms now).",
    };
  } catch (err) {
    captureAdminException(err, { action: "requestKibNomsRepost" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Queue a Town Voting ping for players missing votes on one nomination. */
export async function requestPingMissingVoters(
  gameId: string,
  nominationId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireGameAccess(gameId);
  try {
    const nomination = await prisma.nomination.findFirst({
      where: { id: nominationId, gameDay: { gameId }, status: "open" },
      select: { id: true },
    });
    if (!nomination) {
      return { ok: false, message: "Open nomination not found on this game." };
    }
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { source: true },
    });
    if (!game) return { ok: false, message: "Game not found." };
    if (isStatsOnlyGame(game.source)) {
      return { ok: false, message: "Stats-only games cannot ping Discord voters." };
    }
    await requestDiscordPingMissing(gameId, nominationId);
    revalidatePath(`/games/${gameId}`);
    return {
      ok: true,
      message:
        "Missing-voter ping queued. The bot will mention them in Town Voting within about 30 seconds (or run /st ping-missing).",
    };
  } catch (err) {
    captureAdminException(err, { action: "requestPingMissingVoters" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

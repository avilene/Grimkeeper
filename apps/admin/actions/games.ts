"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getBotcRole } from "@grimkeeper/engine";

import type { SaveResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emptyToNull, parseOptionalInt } from "@/lib/utils";

export type { SaveResult };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session;
}

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

export async function saveGame(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
  try {
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGame(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function savePlayers(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function addPlayer(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deletePlayer(
  gameId: string,
  playerId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireSession();
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveGameDay(
  gameId: string,
  dayId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
  try {
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
      nominationsPausedUntil: (() => {
        const raw = String(formData.get("nominationsPausedUntil") ?? "").trim();
        if (!raw) return null;
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) throw new Error("Invalid paused-until datetime.");
        return date;
      })(),
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
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGameDay(
  gameId: string,
  dayId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireSession();
  try {
    const result = await prisma.gameDay.deleteMany({ where: { id: dayId, gameId } });
    if (result.count === 0) {
      return { ok: false, message: "Day not found on this game." };
    }
    revalidatePath(`/games/${gameId}`);
    return { ok: true, message: "Day deleted." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

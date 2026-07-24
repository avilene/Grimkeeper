"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emptyToNull, parseOptionalInt } from "@/lib/utils";

export type SaveResult = {
  ok: boolean;
  message: string;
};

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session;
}

const PLAYER_TEAMS = new Set(["good", "evil", "traveler"]);

function parsePlayerTeam(value: FormDataEntryValue | null): string | null {
  const team = String(value ?? "").trim().toLowerCase();
  if (!team) return null;
  if (!PLAYER_TEAMS.has(team)) {
    throw new Error(`Invalid team "${team}". Use good, evil, or traveler.`);
  }
  return team;
}

export async function saveGame(
  gameId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireSession();
  try {
    await prisma.game.update({
      where: { id: gameId },
      data: {
        phase: String(formData.get("phase") ?? "").trim() || "lobby",
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
    // List page only — avoid refreshing this detail page (keeps scroll/focus).
    revalidatePath("/games");
    return { ok: true, message: "Game saved." };
  } catch (err) {
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
      playerIds.map((playerId) =>
        prisma.player.update({
          where: { id: playerId },
          data: {
            displayName: String(formData.get(`displayName_${playerId}`) ?? "").trim(),
            discordUserId: String(formData.get(`discordUserId_${playerId}`) ?? "").trim(),
            seat: parseOptionalInt(formData.get(`seat_${playerId}`)),
            roleId: emptyToNull(formData.get(`roleId_${playerId}`)),
            team: parsePlayerTeam(formData.get(`team_${playerId}`)),
            alive: formData.get(`alive_${playerId}`) === "on",
            ghostVoteUsed: formData.get(`ghostVoteUsed_${playerId}`) === "on",
          },
        }),
      ),
    );

    revalidatePath("/games");
    return { ok: true, message: `Saved ${playerIds.length} player${playerIds.length === 1 ? "" : "s"}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

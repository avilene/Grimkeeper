"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { emptyToNull, parseOptionalInt } from "@/lib/utils";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session;
}

export async function saveGame(gameId: string, formData: FormData) {
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
    await setFlash("Game saved.");
  } catch (err) {
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  redirect(`/games/${gameId}`);
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

export async function savePlayer(gameId: string, playerId: string, formData: FormData) {
  await requireSession();
  try {
    await prisma.player.update({
      where: { id: playerId },
      data: {
        displayName: String(formData.get("displayName") ?? "").trim(),
        discordUserId: String(formData.get("discordUserId") ?? "").trim(),
        seat: parseOptionalInt(formData.get("seat")),
        roleId: emptyToNull(formData.get("roleId")),
        team: parsePlayerTeam(formData.get("team")),
        alive: formData.get("alive") === "on",
        ghostVoteUsed: formData.get("ghostVoteUsed") === "on",
      },
    });
    await setFlash("Player saved.");
  } catch (err) {
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/games/${gameId}`);
  redirect(`/games/${gameId}`);
}

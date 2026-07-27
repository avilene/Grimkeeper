"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SaveResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { parseLocalDateTime, parseTimezoneOffsetMinutes } from "@/lib/datetime";
import { emptyToNull } from "@/lib/utils";
import { requireAdmin, requireGameAccess } from "@/lib/session";

export type { SaveResult };

export async function saveReminder(
  reminderId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    formData.get("timezoneOffsetMinutes"),
  );
  const gameId = emptyToNull(formData.get("gameId"));
  const access = gameId ? await requireGameAccess(gameId) : await requireAdmin();

  try {
    const message = String(formData.get("message") ?? "").trim();
    const guildId = String(formData.get("guildId") ?? "").trim();
    const channelId = String(formData.get("channelId") ?? "").trim();
    if (!message || !guildId || !channelId) {
      return { ok: false, message: "Message, guild ID, and channel ID are required." };
    }

    const data = {
      message,
      guildId,
      channelId,
      gameId,
      fireAt: parseLocalDateTime(formData.get("fireAt"), timezoneOffsetMinutes, "Fire at"),
      emoji: emptyToNull(formData.get("emoji")),
      pingPlayers: formData.get("pingPlayers") === "on",
      pingRoleId: emptyToNull(formData.get("pingRoleId")),
      fired: formData.get("fired") === "on",
    };

    if (reminderId) {
      await prisma.gameReminder.update({
        where: { id: reminderId },
        data,
      });
      revalidatePath("/reminders");
      revalidatePath(`/reminders/${reminderId}`);
      if (data.gameId) revalidatePath(`/games/${data.gameId}`);
      return { ok: true, message: "Reminder saved." };
    }

    const created = await prisma.gameReminder.create({
      data: {
        ...data,
        createdBy: access.userId,
      },
    });
    revalidatePath("/reminders");
    if (data.gameId) {
      revalidatePath(`/games/${data.gameId}`);
      redirect(`/games/${data.gameId}`);
    }
    redirect(`/reminders/${created.id}`);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteReminder(
  reminderId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  try {
    const existing = await prisma.gameReminder.findUnique({
      where: { id: reminderId },
      select: { gameId: true },
    });
    if (!existing) return { ok: false, message: "Reminder not found." };
    if (existing.gameId) {
      await requireGameAccess(existing.gameId);
    } else {
      await requireAdmin();
    }
    await prisma.gameReminder.delete({ where: { id: reminderId } });
    revalidatePath("/reminders");
    if (existing.gameId) {
      revalidatePath(`/games/${existing.gameId}`);
      redirect(`/games/${existing.gameId}`);
    }
    redirect("/reminders");
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SaveResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emptyToNull } from "@/lib/utils";

export type { SaveResult };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session;
}

function parseFireAt(value: FormDataEntryValue | null): Date {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Fire at is required.");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid fire-at datetime.");
  return date;
}

export async function saveReminder(
  reminderId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const session = await requireSession();
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
      gameId: emptyToNull(formData.get("gameId")),
      fireAt: parseFireAt(formData.get("fireAt")),
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
        createdBy: session.user!.id!,
      },
    });
    revalidatePath("/reminders");
    if (data.gameId) revalidatePath(`/games/${data.gameId}`);
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
  await requireSession();
  try {
    const existing = await prisma.gameReminder.findUnique({
      where: { id: reminderId },
      select: { gameId: true },
    });
    if (!existing) return { ok: false, message: "Reminder not found." };
    await prisma.gameReminder.delete({ where: { id: reminderId } });
    revalidatePath("/reminders");
    if (existing.gameId) revalidatePath(`/games/${existing.gameId}`);
    redirect("/reminders");
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

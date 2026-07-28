"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addQueueMember,
  closeQueueEntry,
  getQueueEntryById,
  parseScriptImageUrls,
  prisma,
  serializeScriptImageUrls,
  updateQueueEntry,
  type StQueueMemberRole,
} from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { captureAdminException } from "@/lib/sentry";
import { requireAdmin } from "@/lib/session";

function parseImageUrlsFromBody(value: FormDataEntryValue | null): string[] {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return parseScriptImageUrls(serializeScriptImageUrls(lines));
}

function parseMemberRole(value: FormDataEntryValue | null): StQueueMemberRole {
  const role = String(value ?? "").trim();
  if (role === "co_st" || role === "player") return role;
  throw new Error('Role must be "co_st" or "player"');
}

export async function saveQueueEntry(entryId: string, formData: FormData) {
  await requireAdmin();
  try {
    const statusRaw = String(formData.get("status") ?? "").trim();
    if (statusRaw !== "open" && statusRaw !== "closed") {
      throw new Error('Status must be "open" or "closed"');
    }
    const position = Number(formData.get("position"));
    if (!Number.isInteger(position) || position < 1) {
      throw new Error("Position must be a positive integer");
    }
    const ownerDiscordId = String(formData.get("ownerDiscordId") ?? "").trim();
    if (!ownerDiscordId) throw new Error("Owner Discord ID is required");

    await updateQueueEntry(entryId, {
      scriptName: String(formData.get("scriptName") ?? ""),
      scriptLink: String(formData.get("scriptLink") ?? ""),
      description: String(formData.get("description") ?? ""),
      scriptImageUrls: parseImageUrlsFromBody(formData.get("scriptImageUrls")),
      status: statusRaw,
    });
    await prisma.stQueueEntry.update({
      where: { id: entryId },
      data: { position, ownerDiscordId },
    });
    await setFlash("Queue entry saved.");
  } catch (err) {
    captureAdminException(err, { action: "saveQueueEntry", entryId });
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/queues/entries/${entryId}`);
  revalidatePath("/queues");
  redirect(`/queues/entries/${entryId}`);
}

export async function closeQueueEntryAction(entryId: string) {
  await requireAdmin();
  try {
    await closeQueueEntry(entryId);
    await setFlash("Queue entry closed.");
  } catch (err) {
    captureAdminException(err, { action: "closeQueueEntryAction", entryId });
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/queues/entries/${entryId}`);
  revalidatePath("/queues");
  redirect(`/queues/entries/${entryId}`);
}

export async function addQueueMemberAction(entryId: string, formData: FormData) {
  await requireAdmin();
  try {
    const discordUserId = String(formData.get("discordUserId") ?? "").trim();
    if (!discordUserId) throw new Error("Discord user ID is required");
    const role = parseMemberRole(formData.get("role"));
    const entry = await getQueueEntryById(entryId);
    if (!entry) throw new Error("Queue entry not found");
    await addQueueMember(entryId, discordUserId, role);
    await setFlash("Member added.");
  } catch (err) {
    captureAdminException(err, { action: "addQueueMemberAction", entryId });
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/queues/entries/${entryId}`);
  redirect(`/queues/entries/${entryId}`);
}

export async function removeQueueMemberAction(entryId: string, memberId: string) {
  await requireAdmin();
  try {
    const deleted = await prisma.stQueueMember.deleteMany({
      where: { id: memberId, entryId },
    });
    if (deleted.count === 0) throw new Error("Member not found on this entry");
    await setFlash("Member removed.");
  } catch (err) {
    captureAdminException(err, { action: "removeQueueMemberAction", entryId });
    await setFlash(err instanceof Error ? err.message : String(err));
  }
  revalidatePath(`/queues/entries/${entryId}`);
  redirect(`/queues/entries/${entryId}`);
}

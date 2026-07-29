"use server";

import { revalidatePath } from "next/cache";

import type { SaveResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { captureAdminException } from "@/lib/sentry";
import { requireAdmin } from "@/lib/session";

export type { SaveResult };

export async function saveGuildSettings(
  originalGuildId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    const guildId = String(formData.get("guildId") ?? "").trim();
    const archiveCategoryIdRaw = String(formData.get("archiveCategoryId") ?? "").trim();
    const archiveCategoryId = archiveCategoryIdRaw || null;

    if (!guildId) {
      return { ok: false, message: "Guild ID is required." };
    }

    const isEdit = originalGuildId != null;
    if (isEdit && originalGuildId !== guildId) {
      await prisma.$transaction([
        prisma.guildSettings.delete({ where: { guildId: originalGuildId } }),
        prisma.guildSettings.create({
          data: { guildId, archiveCategoryId },
        }),
      ]);
    } else {
      await prisma.guildSettings.upsert({
        where: { guildId },
        create: { guildId, archiveCategoryId },
        update: { archiveCategoryId },
      });
    }

    revalidatePath("/guild-settings");
    return { ok: true, message: isEdit ? "Guild settings saved." : "Guild settings created." };
  } catch (err) {
    captureAdminException(err, { action: "saveGuildSettings" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGuildSettings(
  guildId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    await prisma.guildSettings.delete({ where: { guildId } });
    revalidatePath("/guild-settings");
    return { ok: true, message: "Guild settings deleted." };
  } catch (err) {
    captureAdminException(err, { action: "deleteGuildSettings" });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

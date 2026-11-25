"use server";

import { revalidatePath } from "next/cache";

import type { SaveResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { captureAdminException } from "@/lib/sentry";
import { requireAdmin } from "@/lib/session";

export type { SaveResult };

function optionalCsv(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  return raw || null;
}

function optionalId(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  return raw || null;
}

export async function saveGuildSettings(
  originalGuildId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    const guildId = String(formData.get("guildId") ?? "").trim();
    const archiveCategoryId = optionalId(formData, "archiveCategoryId");
    const allowedRoleIds = optionalCsv(formData, "allowedRoleIds");
    const adminRoleIds = optionalCsv(formData, "adminRoleIds");
    const reminderRoleIds = optionalCsv(formData, "reminderRoleIds");
    const reminderPingRoleId = optionalId(formData, "reminderPingRoleId");

    if (!guildId) {
      return { ok: false, message: "Guild ID is required." };
    }

    const data = {
      archiveCategoryId,
      allowedRoleIds,
      adminRoleIds,
      reminderRoleIds,
      reminderPingRoleId,
    };

    const isEdit = originalGuildId != null;
    if (isEdit && originalGuildId !== guildId) {
      await prisma.$transaction([
        prisma.guildSettings.delete({ where: { guildId: originalGuildId } }),
        prisma.guildSettings.create({
          data: { guildId, ...data },
        }),
      ]);
    } else {
      await prisma.guildSettings.upsert({
        where: { guildId },
        create: { guildId, ...data },
        update: data,
      });
    }

    revalidatePath("/guild-settings");
    revalidatePath(`/guild-settings/${guildId}`);
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

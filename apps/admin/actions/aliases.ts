"use server";

import { revalidatePath } from "next/cache";

import type { SaveResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export type { SaveResult };

export async function saveAlias(
  originalGuildId: string | null,
  originalDiscordUserId: string | null,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    const guildId = String(formData.get("guildId") ?? "").trim();
    const discordUserId = String(formData.get("discordUserId") ?? "").trim();
    const alias = String(formData.get("alias") ?? "").trim();
    if (!guildId || !discordUserId || !alias) {
      return { ok: false, message: "Guild ID, Discord user ID, and alias are required." };
    }

    const isEdit = originalGuildId != null && originalDiscordUserId != null;
    const keyChanged =
      isEdit &&
      (originalGuildId !== guildId || originalDiscordUserId !== discordUserId);

    if (isEdit && keyChanged) {
      await prisma.$transaction([
        prisma.playerAlias.delete({
          where: {
            guildId_discordUserId: {
              guildId: originalGuildId!,
              discordUserId: originalDiscordUserId!,
            },
          },
        }),
        prisma.playerAlias.create({
          data: { guildId, discordUserId, alias },
        }),
      ]);
    } else {
      await prisma.playerAlias.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, discordUserId, alias },
        update: { alias },
      });
    }

    revalidatePath("/aliases");
    return { ok: true, message: isEdit ? "Alias saved." : "Alias created." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteAlias(
  guildId: string,
  discordUserId: string,
  _prev: SaveResult | null,
  _formData: FormData,
): Promise<SaveResult> {
  await requireAdmin();
  try {
    await prisma.playerAlias.delete({
      where: { guildId_discordUserId: { guildId, discordUserId } },
    });
    revalidatePath("/aliases");
    return { ok: true, message: "Alias deleted." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

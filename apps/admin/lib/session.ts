import { redirect } from "next/navigation";

import {
  canEditGame,
  getAccessProfile,
  homePathForAccess,
  type AccessProfile,
} from "@/lib/access";

export async function requireSession(): Promise<AccessProfile> {
  const access = await getAccessProfile();
  if (!access) redirect("/login");
  return access;
}

export async function requireAdmin(): Promise<AccessProfile> {
  const access = await requireSession();
  if (!access.isAdmin) redirect(homePathForAccess(access));
  return access;
}

/** Admin or storyteller for this game (view/edit projection). */
export async function requireGameAccess(gameId: string): Promise<AccessProfile> {
  const access = await requireSession();
  if (!canEditGame(access, gameId)) redirect(homePathForAccess(access));
  return access;
}

/** Full admin tools (record game, delete, reminders/aliases/queues). */
export async function requireAdminAction(): Promise<AccessProfile> {
  return requireAdmin();
}

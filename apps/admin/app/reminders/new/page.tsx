import Link from "next/link";
import { redirect } from "next/navigation";

import { ReminderForm } from "@/components/reminder-form";
import { Button } from "@/components/ui/button";
import { canViewGame, getAccessProfile, homePathForAccess } from "@/lib/access";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "New reminder" };

export default async function NewReminderPage({
  searchParams,
}: {
  searchParams: Promise<{ gameId?: string }>;
}) {
  const { gameId: rawGameId } = await searchParams;
  const gameId = rawGameId?.trim() || null;

  if (gameId) {
    const access = await getAccessProfile();
    if (!access) redirect("/login");
    if (!canViewGame(access, gameId)) redirect(homePathForAccess(access));
  } else {
    await requireAdmin();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">New reminder</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href={gameId ? `/games/${gameId}` : "/reminders"}>Back</Link>
        </Button>
      </div>
      <ReminderForm defaultGameId={gameId ?? undefined} />
    </div>
  );
}

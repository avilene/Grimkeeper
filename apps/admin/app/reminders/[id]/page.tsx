import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReminderForm } from "@/components/reminder-form";
import { Button } from "@/components/ui/button";
import { canViewGame, getAccessProfile, homePathForAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { shortId } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Reminder ${shortId(id)}` };
}

export default async function ReminderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reminder = await prisma.gameReminder.findUnique({ where: { id } });
  if (!reminder) notFound();

  if (reminder.gameId) {
    const access = await getAccessProfile();
    if (!access) redirect("/login");
    if (!canViewGame(access, reminder.gameId)) redirect(homePathForAccess(access));
  } else {
    await requireAdmin();
  }

  const backHref = reminder.gameId ? `/games/${reminder.gameId}` : "/reminders";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reminder {shortId(reminder.id)}</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href={backHref}>Back</Link>
        </Button>
      </div>
      <ReminderForm reminder={reminder} />
    </div>
  );
}

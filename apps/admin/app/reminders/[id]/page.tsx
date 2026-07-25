import Link from "next/link";
import { notFound } from "next/navigation";

import { ReminderForm } from "@/components/reminder-form";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reminder {shortId(reminder.id)}</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/reminders">Back</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        ID <code>{reminder.id}</code> · created by <code>{reminder.createdBy}</code>
      </p>
      <ReminderForm reminder={reminder} />
    </div>
  );
}

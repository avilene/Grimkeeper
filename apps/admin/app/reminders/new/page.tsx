import Link from "next/link";

import { ReminderForm } from "@/components/reminder-form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "New reminder" };

export default async function NewReminderPage({
  searchParams,
}: {
  searchParams: Promise<{ gameId?: string }>;
}) {
  const { gameId } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">New reminder</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/reminders">Back</Link>
        </Button>
      </div>
      <ReminderForm defaultGameId={gameId} />
    </div>
  );
}

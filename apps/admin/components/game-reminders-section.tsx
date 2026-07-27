"use client";

import Link from "next/link";

import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shortId } from "@/lib/utils";

export type GameReminderRow = {
  id: string;
  message: string;
  fireAt: Date;
  channelId: string;
  fired: boolean;
  pingPlayers: boolean;
};

export function GameRemindersSection({
  gameId,
  reminders,
}: {
  gameId: string;
  reminders: GameReminderRow[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Reminders linked to this game. Full CRUD is on the Reminders page.
        </p>
        <Link
          href={`/reminders/new?gameId=${encodeURIComponent(gameId)}`}
          className="text-sm text-primary hover:underline"
        >
          Add reminder
        </Link>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reminders for this game.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reminders.map((reminder) => (
              <TableRow key={reminder.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  <Link
                    href={`/reminders/${reminder.id}`}
                    className="text-primary hover:underline"
                  >
                    <LocalTime value={reminder.fireAt} />
                  </Link>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{reminder.message}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(reminder.channelId, 10)}</TableCell>
                <TableCell>
                  <Badge variant={reminder.fired ? "secondary" : "default"}>
                    {reminder.fired ? "fired" : "pending"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

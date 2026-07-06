import type { Client } from "discord.js";
import { listDueReminders, markReminderFired } from "@grimkeeper/database";

import { reportError } from "./error-reporter.js";

export async function processDueReminders(client: Client): Promise<void> {
  const due = await listDueReminders();
  for (const reminder of due) {
    try {
      const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
      if (channel?.isTextBased() && !channel.isDMBased()) {
        await channel.send(`⏰ ${reminder.message}`).catch(() => undefined);
      }
      await markReminderFired(reminder.id);
    } catch (error) {
      void reportError("reminder.fire.failed", error, {
        reminderId: reminder.id,
        gameId: reminder.gameId,
      });
    }
  }
}

export function startReminderScheduler(client: Client, intervalMs = 30_000): void {
  void processDueReminders(client).catch((error: unknown) => {
    void reportError("reminder.scheduler.tick.failed", error);
  });
  setInterval(() => {
    void processDueReminders(client).catch((error: unknown) => {
      void reportError("reminder.scheduler.tick.failed", error);
    });
  }, intervalMs);
}

import type { Client } from "discord.js";
import { claimReminderForFire, listDueReminders } from "@grimkeeper/database";

import { buildReminderPingMention, buildReminderFireContent } from "./commands/command-context.js";
import { formatReminderText } from "./reminder-message.js";
import { reportError } from "./error-reporter.js";

let schedulerStarted = false;
let processingDueReminders = false;

export async function processDueReminders(client: Client): Promise<void> {
  if (processingDueReminders) return;
  processingDueReminders = true;

  try {
    const due = await listDueReminders();
    for (const reminder of due) {
      try {
        const claimed = await claimReminderForFire(reminder.id);
        if (!claimed) continue;

        const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
        if (channel?.isTextBased() && !channel.isDMBased()) {
          let content = formatReminderText(reminder.message, reminder.emoji);
          if (reminder.pingPlayers) {
            const ping = await buildReminderPingMention(reminder);
            content = buildReminderFireContent(
              ping,
              reminder.message,
              reminder.fireAt,
              reminder.emoji,
            );
          }
          await channel.send(content).catch(() => undefined);
        }
      } catch (error) {
        void reportError("reminder.fire.failed", error, {
          reminderId: reminder.id,
          gameId: reminder.gameId,
        });
      }
    }
  } finally {
    processingDueReminders = false;
  }
}

export function startReminderScheduler(client: Client, intervalMs = 30_000): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  void processDueReminders(client).catch((error: unknown) => {
    void reportError("reminder.scheduler.tick.failed", error);
  });
  setInterval(() => {
    void processDueReminders(client).catch((error: unknown) => {
      void reportError("reminder.scheduler.tick.failed", error);
    });
  }, intervalMs);
}

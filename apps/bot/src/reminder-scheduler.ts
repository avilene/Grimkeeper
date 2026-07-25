import type { Client } from "discord.js";
import {
  claimReminderAndDuplicates,
  listDueReminders,
  normalizeReminderMessage,
} from "@grimkeeper/database";

import { buildReminderPingMention, buildReminderFireContent } from "./commands/command-context.js";
import { logReminderAction } from "./action-log.js";
import { processPendingDiscordNomsRefresh } from "./discord-noms-refresh-scheduler.js";
import { reportError } from "./error-reporter.js";

let schedulerStarted = false;
let processingDueReminders = false;

/** Collapse duplicate due rows (same channel/message/near fire time) within one tick. */
export function reminderSendDedupeKey(reminder: {
  channelId: string;
  message: string;
  fireAt: Date;
}): string {
  // 3-minute buckets so stacked rows a few seconds apart share a key.
  const bucket = Math.floor(new Date(reminder.fireAt).getTime() / 180_000);
  return `${reminder.channelId}:${bucket}:${normalizeReminderMessage(reminder.message)}`;
}

export async function processDueReminders(client: Client): Promise<void> {
  if (processingDueReminders) return;
  processingDueReminders = true;

  try {
    const due = await listDueReminders();
    const sentKeys = new Set<string>();

    for (const reminder of due) {
      try {
        const dedupeKey = reminderSendDedupeKey(reminder);
        if (sentKeys.has(dedupeKey)) {
          // Still claim so duplicate rows do not fire on a later tick.
          await claimReminderAndDuplicates(reminder);
          continue;
        }

        const claimed = await claimReminderAndDuplicates(reminder);
        if (!claimed) continue;

        const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
        if (channel?.isTextBased() && !channel.isDMBased()) {
          let content: string;
          if (reminder.pingPlayers) {
            const ping = await buildReminderPingMention(reminder);
            content = buildReminderFireContent(
              ping,
              reminder.message,
              reminder.fireAt,
              reminder.emoji,
              reminder.seriesEndAt,
            );
          } else {
            content = buildReminderFireContent(
              null,
              reminder.message,
              reminder.fireAt,
              reminder.emoji,
              reminder.seriesEndAt,
            );
          }
          await channel.send(content).catch(() => undefined);
          sentKeys.add(dedupeKey);
          logReminderAction("fired", {
            reminderId: reminder.id,
            gameId: reminder.gameId ?? undefined,
            guildId: reminder.guildId,
            channelId: reminder.channelId,
            message: reminder.message,
            emoji: reminder.emoji ?? undefined,
            pingPlayers: reminder.pingPlayers,
            pingRoleId: reminder.pingRoleId ?? undefined,
          });
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
  void processPendingDiscordNomsRefresh(client).catch((error: unknown) => {
    void reportError("discord.noms.refresh.tick.failed", error);
  });
  setInterval(() => {
    void processDueReminders(client).catch((error: unknown) => {
      void reportError("reminder.scheduler.tick.failed", error);
    });
    void processPendingDiscordNomsRefresh(client).catch((error: unknown) => {
      void reportError("discord.noms.refresh.tick.failed", error);
    });
  }, intervalMs);
}

import { log } from "./logger.js";

export async function loadCommandModules(): Promise<void> {
  log("info", "commands.load.start", { botMode: "minimal" });

  await import("./commands/game-minimal.js");
  await import("./commands/player-day-minimal.js");
  await import("./commands/whisper.js");
  await import("./commands/backpack.js");
  await import("./commands/alias.js");
  await import("./commands/stats.js");
  await import("./commands/role.js");
  await import("./commands/script.js");
  await import("./commands/st-minimal.js");
  await import("./commands/st-reminders.js");
  // Queue slash commands only exist when configured — avoids registering dead `/st queue` cmds.
  const stQueueEnabled = Boolean(process.env.ST_QUEUE_THREAD_ID?.trim());
  if (stQueueEnabled) {
    await import("./commands/st-queue.js");
  }
  await import("./commands/interest.js");
  await import("./commands/command-help.js");
  await import("./commands/dev-minimal.js");

  log("info", "commands.load.done", {
    botMode: "minimal",
    stQueueEnabled,
    groups: [
      "game",
      "player",
      "nominate",
      "defend",
      "accusation",
      "vote",
      "privatevote",
      "roster",
      "whisper",
      "backpack",
      "alias",
      "stats",
      "role",
      "script",
      "st",
      "reminder",
      "listreminders",
      "clearreminders",
      "interest",
      "dev",
    ],
  });
}

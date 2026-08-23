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
  // Always register `/st queue` — board thread is per-guild via `/st queue set` (env is optional fallback).
  await import("./commands/st-queue.js");
  await import("./commands/interest.js");
  await import("./commands/command-help.js");
  await import("./commands/dev-minimal.js");

  log("info", "commands.load.done", {
    botMode: "minimal",
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
      "st.queue",
      "reminder",
      "listreminders",
      "clearreminders",
      "interest",
      "dev",
    ],
  });
}

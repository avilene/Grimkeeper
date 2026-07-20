import { log } from "./logger.js";

export async function loadCommandModules(): Promise<void> {
  log("info", "commands.load.start", { botMode: "minimal" });

  await import("./commands/game-minimal.js");
  await import("./commands/player-day-minimal.js");
  await import("./commands/alias.js");
  await import("./commands/st-minimal.js");
  await import("./commands/st-reminders.js");
  await import("./commands/command-help.js");
  await import("./commands/dev-minimal.js");

  log("info", "commands.load.done", {
    botMode: "minimal",
    groups: ["game", "nominate", "defend", "vote", "roster", "alias", "st", "dev"],
  });
}

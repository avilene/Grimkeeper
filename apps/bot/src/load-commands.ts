import { isMinimalMode } from "./bot-mode.js";
import { log } from "./logger.js";

export async function loadCommandModules(): Promise<void> {
  const mode = isMinimalMode() ? "minimal" : "full";
  log("info", "commands.load.start", { botMode: mode });

  if (isMinimalMode()) {
    await import("./commands/game-minimal.js");
    await import("./commands/st-minimal.js");
    await import("./commands/dev-minimal.js");
    log("info", "commands.load.done", { botMode: "minimal", groups: ["game", "st", "dev"] });
    return;
  }

  await import("./commands/game.js");
  await import("./commands/st.js");
  await import("./commands/dev.js");
  log("info", "commands.load.done", { botMode: "full", groups: ["game", "st", "dev"] });
}

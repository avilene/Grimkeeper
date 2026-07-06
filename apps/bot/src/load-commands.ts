import { isMinimalMode } from "./bot-mode.js";

export async function loadCommandModules(): Promise<void> {
  if (isMinimalMode()) {
    await import("./commands/game-minimal.js");
    await import("./commands/st-minimal.js");
    await import("./commands/dev-minimal.js");
    return;
  }

  await import("./commands/game.js");
  await import("./commands/st.js");
  await import("./commands/dev.js");
}

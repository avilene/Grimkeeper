import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadCommandModules", () => {
  const original = process.env.BOT_MODE;

  afterEach(() => {
    vi.resetModules();
    if (original === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = original;
    }
  });

  it("loads minimal command modules when BOT_MODE=minimal", async () => {
    process.env.BOT_MODE = "minimal";
    const { loadCommandModules } = await import("./load-commands.js");
    await expect(loadCommandModules()).resolves.toBeUndefined();
  });

  it("loads full command modules when BOT_MODE=full", async () => {
    process.env.BOT_MODE = "full";
    const { loadCommandModules } = await import("./load-commands.js");
    await expect(loadCommandModules()).resolves.toBeUndefined();
  });
});

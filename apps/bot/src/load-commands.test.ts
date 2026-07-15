import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("imports st-minimal in minimal mode", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "load-commands.ts"),
      "utf8",
    );
    expect(source).toContain('./commands/st-minimal.js');
  });
});

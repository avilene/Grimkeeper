import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadCommandModules", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("loads command modules", async () => {
    const { loadCommandModules } = await import("./load-commands.js");
    await expect(loadCommandModules()).resolves.toBeUndefined();
  });

  it("imports minimal command modules only", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "load-commands.ts"),
      "utf8",
    );
    expect(source).toContain('./commands/st-minimal.js');
    expect(source).toContain('./commands/player-day-minimal.js');
    expect(source).toContain('./commands/game-minimal.js');
    expect(source).toContain('./commands/alias.js');
    expect(source).toContain('./commands/role.js');
    expect(source).toContain('./commands/command-help.js');
    expect(source).toContain('./commands/st-queue.js');
    expect(source).not.toContain('./commands/game.js');
    expect(source).not.toContain('./commands/st.js');
    expect(source).not.toContain('./commands/dev.js');
    expect(source).not.toContain("ST_QUEUE_THREAD_ID");
  });

  it("keeps /role as a public lookup (no allowlist gate)", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "commands/role.ts"),
      "utf8",
    );
    expect(source).not.toContain("requireCommandAccess");
    expect(source).not.toContain("ADMIN_IDS");
    expect(source).not.toContain("ALLOWED_ROLE_IDS");
  });
});

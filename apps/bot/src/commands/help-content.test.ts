import { afterEach, describe, expect, it } from "vitest";

import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildStHelpEmbeds,
} from "./help-content.js";

describe("help content", () => {
  const originalMode = process.env.BOT_MODE;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = originalMode;
    }
  });

  it("builds minimal-mode game and st guides", () => {
    process.env.BOT_MODE = "minimal";

    const game = buildGameHelpEmbeds()[0]!;
    const st = buildStHelpEmbeds()[0]!;

    expect(game.data.title).toBe("Game commands");
    expect(game.data.fields?.some((field) => field.name === "Town (channel only)")).toBe(true);
    expect(st.data.title).toContain("minimal mode");
    expect(st.data.description).toContain("/st setup-town");
  });

  it("builds full-mode guides", () => {
    process.env.BOT_MODE = "full";

    const game = buildGameHelpEmbeds()[0]!;
    const st = buildStHelpEmbeds()[0]!;

    expect(game.data.fields?.some((field) => field.name === "Day thread")).toBe(true);
    expect(st.data.title).toContain("full mode");
    expect(st.data.fields?.some((field) => field.name === "Night & day")).toBe(true);
  });

  it("builds dev guides in both modes", () => {
    process.env.BOT_MODE = "minimal";
    expect(buildDevHelpEmbeds()[0]?.data.fields?.[0]?.name).toBe("Lobby testing");

    process.env.BOT_MODE = "full";
    expect(buildDevHelpEmbeds()[0]?.data.fields?.some((field) => field.name === "Day testing")).toBe(
      true,
    );
  });
});

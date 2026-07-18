import { afterEach, describe, expect, it } from "vitest";

import { GAME_LOBBY_ACTIONS, PLAYER_DAY_ACTIONS, ST_DO_ACTIONS } from "./action-catalog.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildStHelpEmbeds,
} from "./help-content.js";

function fieldValues(embed: { data: { fields?: { name?: string | null; value: string }[] } }) {
  return (embed.data.fields ?? []).map((field) => field.value).join("\n");
}

describe("help content", () => {
  const originalMode = process.env.BOT_MODE;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = originalMode;
    }
  });

  it("builds minimal-mode game and st guides from catalogs", () => {
    process.env.BOT_MODE = "minimal";

    const game = buildGameHelpEmbeds()[0]!;
    const st = buildStHelpEmbeds()[0]!;
    const gameText = fieldValues(game);
    const stText = fieldValues(st);

    expect(game.data.title).toBe("Player commands");
    expect(game.data.description).toContain("Town Voting");
    expect(game.data.description).toContain("/nominate");
    expect(game.data.fields?.[0]?.name).toBe("Day");
    for (const action of PLAYER_DAY_ACTIONS) {
      expect(gameText).toContain(`/${action.name}`);
      expect(gameText).toContain(action.description);
    }
    for (const action of GAME_LOBBY_ACTIONS) {
      expect(gameText).toContain(`/game ${action.name}`);
      expect(gameText).toContain(action.description);
    }

    expect(st.data.title).toContain("minimal mode");
    expect(st.data.description).toContain("/game setup");
    expect(st.data.description).toContain("log thread");
    for (const action of ST_DO_ACTIONS) {
      expect(stText).toContain(`/st do ${action.name}`);
      expect(stText).toContain(action.description);
    }
    expect(stText.toLowerCase()).toContain("close-nominations");
    expect(stText.toLowerCase()).toContain("next-phase");
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

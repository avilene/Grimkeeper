import { describe, expect, it } from "vitest";

import {
  GAME_LOBBY_ACTIONS,
  PLAYER_DAY_ACTIONS,
  PLAYER_VOTE_ACTIONS,
  ST_DO_ACTIONS,
} from "./action-catalog.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildStHelpEmbeds,
} from "./help-content.js";

function fieldValues(embed: { data: { fields?: { name?: string | null; value: string }[] } }) {
  return (embed.data.fields ?? []).map((field) => field.value).join("\n");
}

describe("help content", () => {
  it("builds game and st guides from catalogs", () => {
    const game = buildGameHelpEmbeds()[0]!;
    const st = buildStHelpEmbeds()[0]!;
    const gameText = fieldValues(game);
    const stText = fieldValues(st);

    expect(game.data.title).toBe("Player commands");
    expect(game.data.description).toContain("Town Voting");
    expect(game.data.description).toContain("/nominate");
    expect(game.data.description).toContain("/vote");
    expect(game.data.description).toContain("/privatevote");
    expect(game.data.description).toContain("/game help");
    expect(game.data.description).toContain("/game commands");
    expect(game.data.fields?.[0]?.name).toBe("Voting");
    expect(game.data.fields?.[1]?.name).toBe("Day");
    for (const action of PLAYER_VOTE_ACTIONS) {
      expect(gameText).toContain(`/${action.name}`);
      expect(gameText).toContain(action.description);
    }
    for (const action of PLAYER_DAY_ACTIONS) {
      expect(gameText).toContain(`/${action.name}`);
      expect(gameText).toContain(action.description);
    }
    for (const action of GAME_LOBBY_ACTIONS) {
      expect(gameText).toContain(`/game ${action.name}`);
      expect(gameText).toContain(action.description);
    }

    expect(st.data.title).toBe("Storyteller guide");
    expect(st.data.description).toContain("/game setup");
    expect(st.data.description).toContain("log thread");
    for (const action of ST_DO_ACTIONS) {
      expect(stText).toContain(`/st do ${action.name}`);
      expect(stText).toContain(action.description);
    }
    expect(stText.toLowerCase()).toContain("close-nominations");
    expect(stText.toLowerCase()).toContain("next-phase");
    expect(stText.toLowerCase()).toContain("add-st");
  });

  it("builds dev guides", () => {
    expect(buildDevHelpEmbeds()[0]?.data.fields?.[0]?.name).toBe("Lobby testing");
  });
});

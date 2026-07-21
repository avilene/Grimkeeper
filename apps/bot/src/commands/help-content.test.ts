import { describe, expect, it } from "vitest";

import {
  GAME_LOBBY_ACTIONS,
  PLAYER_DAY_ACTIONS,
  PLAYER_VOTE_ACTIONS,
  ST_DO_ACTIONS,
  ST_SETUP_ACTIONS,
} from "./action-catalog.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildHelpSearchEmbeds,
  buildStGuideEmbed,
  buildStHelpEmbeds,
  searchHelpEntries,
  GAME_HELP_ENTRIES,
  ST_HELP_ENTRIES,
  DEV_HELP_ENTRIES,
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
    expect(game.data.description).not.toContain("/game commands");
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
    for (const action of ST_SETUP_ACTIONS) {
      expect(gameText).toContain(`/st do ${action.name}`);
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
    expect(st.data.description).toContain("/st guide");
    expect(stText).toContain("/st guide");
  });

  it("builds phase checklists", () => {
    const setup = buildStGuideEmbed("setup");
    const day = buildStGuideEmbed("day");
    const night = buildStGuideEmbed("night");
    expect(setup.data.title).toContain("Setup");
    expect(fieldValues(setup)).toContain("/st do setup-town");
    expect(day.data.title).toContain("Day");
    expect(fieldValues(day)).toContain("/st do close-nominations");
    expect(fieldValues(day)).toContain("/st do next-phase");
    expect(night.data.title).toContain("Night");
    expect(fieldValues(night)).toContain("/st do say");
    expect(fieldValues(night)).toContain("/st do mark-dead");
    for (const embed of [setup, day, night]) {
      for (const field of embed.data.fields ?? []) {
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
    }
  });

  it("builds dev guides", () => {
    expect(buildDevHelpEmbeds()[0]?.data.fields?.[0]?.name).toBe("Lobby testing");
  });

  it("searches help catalogs by command or description", () => {
    const voteHits = searchHelpEntries(GAME_HELP_ENTRIES, "vote");
    expect(voteHits.some((entry) => entry.command === "/vote")).toBe(true);
    expect(voteHits.some((entry) => entry.command === "/privatevote")).toBe(true);

    const whisperHits = searchHelpEntries(GAME_HELP_ENTRIES, "neighbor");
    expect(whisperHits.some((entry) => entry.command.includes("whisper"))).toBe(true);

    const phaseHits = searchHelpEntries(ST_HELP_ENTRIES, "next-phase");
    expect(phaseHits.some((entry) => entry.command === "/st do next-phase")).toBe(true);

    const remindHits = searchHelpEntries(ST_HELP_ENTRIES, "reminder");
    expect(remindHits.length).toBeGreaterThan(1);

    const fillHits = searchHelpEntries(DEV_HELP_ENTRIES, "fake");
    expect(fillHits.some((entry) => entry.command === "/dev fill")).toBe(true);

    const embed = buildHelpSearchEmbeds("st", "whisper")[0]!;
    expect(embed.data.title).toBe("Storyteller help search");
    expect(embed.data.description).toMatch(/match/);

    const empty = buildHelpSearchEmbeds("game", "zzzz-no-match")[0]!;
    expect(empty.data.description).toContain("No commands matched");
  });
});

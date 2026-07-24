import { describe, expect, it } from "vitest";

import {
  GAME_LOBBY_ACTIONS,
  PLAYER_DAY_ACTIONS,
  PLAYER_VOTE_ACTIONS,
  ST_DO_ACTIONS,
  ST_SETUP_ACTIONS,
  ST_SLASH_SHORTCUTS,
} from "./action-catalog.js";
import {
  buildDevHelpEmbeds,
  buildGameHelpEmbeds,
  buildHelpSearchEmbeds,
  buildPlayerHelpEmbeds,
  buildStGuideEmbed,
  buildStHelpEmbeds,
  searchHelpEntries,
  GAME_HELP_ENTRIES,
  PLAYER_HELP_ENTRIES,
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
    expect(game.data.description).toContain("/player help");
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
      const prefix = ST_SLASH_SHORTCUTS.some((s) => s.name === action.name) ? "/st" : "/st do";
      expect(gameText).toContain(`${prefix} ${action.name}`);
      expect(gameText).toContain(action.description);
    }
    expect(gameText).toContain("/st setup-town");
    expect(gameText).toContain("/st log");
    expect(gameText).toContain("/st do recreate-threads");

    expect(st.data.title).toBe("Storyteller guide");
    expect(st.data.description).toContain("/game setup");
    expect(st.data.description).toContain("log thread");
    expect(st.data.description).toContain("/st next-phase");
    expect(st.data.description).toContain("/st broadcast");
    for (const action of ST_SLASH_SHORTCUTS) {
      expect(stText).toContain(`/st ${action.name}`);
      expect(stText).toContain(action.description);
    }
    for (const action of ST_DO_ACTIONS.filter((a) => a.name !== "say")) {
      expect(stText).toContain(`/st do ${action.name}`);
      expect(stText).toContain(action.description);
    }
    expect(stText).toContain("/st broadcast");
    expect(stText).not.toContain("/st do say");
    expect(stText).not.toContain("/st say");
    expect(stText.toLowerCase()).toContain("close-nominations");
    expect(stText.toLowerCase()).toContain("next-phase");
    expect(stText.toLowerCase()).toContain("add-st");
    expect(st.data.description).toContain("/st guide setup");
    expect(stText).toContain("/st guide setup|day|night");
    expect(stText).toContain("/st add-kib / remove-kib");
    for (const field of st.data.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    expect((st.data.description ?? "").length).toBeLessThanOrEqual(4096);
  });

  it("builds phase checklists", () => {
    const setup = buildStGuideEmbed("setup");
    const day = buildStGuideEmbed("day");
    const night = buildStGuideEmbed("night");
    expect(setup.data.title).toContain("Setup");
    expect(fieldValues(setup)).toContain("/st setup-town");
    expect(fieldValues(setup)).toContain("/st broadcast");
    expect(day.data.title).toContain("Day");
    expect(fieldValues(day)).toContain("/st close-nominations");
    expect(fieldValues(day)).toContain("/st next-phase");
    expect(night.data.title).toContain("Night");
    expect(fieldValues(night)).toContain("/st broadcast");
    expect(fieldValues(night)).toContain("/st mark-dead");
    expect(fieldValues(setup)).not.toContain("/st say");
    expect(fieldValues(night)).not.toContain("/st say");
    for (const embed of [setup, day, night]) {
      for (const field of embed.data.fields ?? []) {
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
    }
  });

  it("builds player day-play guide", () => {
    const player = buildPlayerHelpEmbeds()[0]!;
    const text = fieldValues(player);

    expect(player.data.title).toBe("Player day commands");
    expect(player.data.description).toContain("/player help");
    expect(text).toContain("/nominate");
    expect(text).toContain("/vote");
    expect(text).toContain("/privatevote");
    expect(text).toContain("/whisper neighbor");
    expect(text).toContain("/whisper with");
    expect(text).toContain("/alias");
    expect(text).not.toContain("/game setup");
    expect(text).not.toContain("/st setup-town");

    const whisperHits = searchHelpEntries(PLAYER_HELP_ENTRIES, "whisper");
    expect(whisperHits.some((entry) => entry.command.includes("whisper"))).toBe(true);

    const search = buildHelpSearchEmbeds("player", "alias")[0]!;
    expect(search.data.title).toBe("Day-play help search");
    expect(search.data.description).toMatch(/match/);
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
    expect(phaseHits.some((entry) => entry.command === "/st next-phase")).toBe(true);
    expect(phaseHits.some((entry) => entry.command === "/st do next-phase")).toBe(true);

    const broadcastHits = searchHelpEntries(ST_HELP_ENTRIES, "broadcast");
    expect(broadcastHits.some((entry) => entry.command === "/st broadcast")).toBe(true);
    expect(broadcastHits.some((entry) => entry.command === "/st do broadcast")).toBe(true);
    expect(broadcastHits.some((entry) => entry.command === "/st do say")).toBe(false);

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

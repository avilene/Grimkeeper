import { describe, expect, it } from "vitest";

import {
  GAME_LOBBY_ACTIONS,
  PLAYER_DAY_ACTIONS,
  PLAYER_VOTE_ACTIONS,
  ST_ROOT_ACTIONS,
  ST_SETUP_ACTIONS,
  stRootSlashName,
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

function embedTextSize(embed: {
  data: {
    title?: string | null;
    description?: string | null;
    fields?: { name?: string | null; value: string }[];
    footer?: { text?: string | null } | null;
    author?: { name?: string | null } | null;
  };
}): number {
  const d = embed.data;
  let total =
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text?.length ?? 0) +
    (d.author?.name?.length ?? 0);
  for (const field of d.fields ?? []) {
    total += (field.name?.length ?? 0) + field.value.length;
  }
  return total;
}

describe("help content", () => {
  it("builds game and st guides from catalogs", () => {
    const game = buildGameHelpEmbeds()[0]!;
    const stEmbeds = buildStHelpEmbeds();
    const st = stEmbeds[0]!;
    const gameText = fieldValues(game);
    const stText = stEmbeds.map(fieldValues).join("\n");

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
      expect(gameText).toContain(`/${stRootSlashName(action.name)}`);
      expect(gameText).toContain(action.description);
    }
    expect(gameText).toContain("/setup-town");
    expect(gameText).toContain("/log");
    expect(gameText).toContain("/recreate-threads");

    expect(st.data.title).toBe("Storyteller guide");
    expect(stEmbeds.length).toBeGreaterThan(1);
    expect(st.data.description).toContain("/game setup");
    expect(st.data.description).toContain("add the Grimkeeper bot");
    expect(st.data.description).toContain("log thread");
    expect(st.data.description).toContain("/next-phase");
    expect(st.data.description).toContain("/broadcast");
    for (const action of ST_ROOT_ACTIONS) {
      expect(stText).toContain(`/${action.name}`);
      expect(stText).toContain(action.description);
    }
    expect(stText).toContain("/broadcast");
    expect(stText).not.toContain("/st do say");
    expect(stText).not.toContain("/st say");
    expect(stText.toLowerCase()).toContain("close-nominations");
    expect(stText.toLowerCase()).toContain("next-phase");
    expect(stText.toLowerCase()).toContain("add-st");
    expect(st.data.description).toContain("/st guide topic: setup");
    expect(stText).toContain("/st guide topic: setup|buffet|day|night");
    expect(stText).toContain("/add-kib · /remove-kib");
    for (const embed of stEmbeds) {
      for (const field of embed.data.fields ?? []) {
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
      expect((embed.data.description ?? "").length).toBeLessThanOrEqual(4096);
      expect(embedTextSize(embed)).toBeLessThanOrEqual(6000);
    }
    // Discord also caps combined embed text in one message at 6000 — ST help must paginate.
    const stCombined = stEmbeds.reduce((sum, embed) => sum + embedTextSize(embed), 0);
    expect(stCombined).toBeGreaterThan(6000);
  });

  it("builds phase checklists", () => {
    const setup = buildStGuideEmbed("setup");
    const buffet = buildStGuideEmbed("buffet");
    const day = buildStGuideEmbed("day");
    const night = buildStGuideEmbed("night");
    expect(setup.data.title).toContain("Setup");
    expect(fieldValues(setup)).toContain("/setup-town");
    expect(fieldValues(setup)).toContain("/broadcast");
    expect(fieldValues(setup)).toContain("add the Grimkeeper bot");
    expect(buffet.data.title).toContain("Sushi Buffet");
    expect(fieldValues(buffet)).toContain("/buffet-start");
    expect(fieldValues(buffet)).toContain("Recycle unchosen roles");
    expect(fieldValues(buffet)).toContain("add the Grimkeeper bot");
    expect(day.data.title).toContain("Day");
    expect(fieldValues(day)).toContain("/close-nominations");
    expect(fieldValues(day)).toContain("/next-phase");
    expect(night.data.title).toContain("Night");
    expect(fieldValues(night)).toContain("/broadcast");
    expect(fieldValues(night)).toContain("/mark-dead");
    expect(fieldValues(setup)).not.toContain("/st say");
    expect(fieldValues(night)).not.toContain("/st say");
    for (const embed of [setup, buffet, day, night]) {
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
    expect(text).toContain("/accusation");
    expect(text).toContain("/vote");
    expect(text).toContain("/privatevote");
    expect(text).toContain("/whisper neighbor");
    expect(text).toContain("/whisper with");
    expect(text).toContain("/alias");
    expect(text).toContain("/stats");
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
    expect(phaseHits.some((entry) => entry.command === "/next-phase")).toBe(true);

    const broadcastHits = searchHelpEntries(ST_HELP_ENTRIES, "broadcast");
    expect(broadcastHits.some((entry) => entry.command === "/broadcast")).toBe(true);
    expect(broadcastHits.some((entry) => entry.command === "/st do say")).toBe(false);

    const kibHits = searchHelpEntries(ST_HELP_ENTRIES, "add-kib");
    expect(kibHits.some((entry) => entry.command === "/add-kib")).toBe(true);

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

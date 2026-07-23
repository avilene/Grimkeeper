import { describe, expect, it } from "vitest";

import {
  parseStPanelButtonCustomId,
  parseStPanelFooter,
  stPanelButtonCustomId,
  stPanelFooter,
} from "./st-control-panel.js";

describe("st control panel ids", () => {
  it("round-trips game ids in button customIds", () => {
    const gameId = "abcdef12-3456-7890-abcd-ef1234567890";
    const customId = stPanelButtonCustomId("refresh", gameId);
    expect(parseStPanelButtonCustomId(customId)).toEqual({
      action: "refresh",
      gameId,
    });
  });

  it("round-trips game ids in embed footers", () => {
    const gameId = "abcdef12-3456-7890-abcd-ef1234567890";
    expect(parseStPanelFooter(stPanelFooter(gameId))).toBe(gameId);
  });

  it("parses next-phase actions without eating the game id", () => {
    const gameId = "11111111-2222-3333-4444-555555555555";
    expect(parseStPanelButtonCustomId(stPanelButtonCustomId("next-phase", gameId))).toEqual({
      action: "next-phase",
      gameId,
    });
  });
});

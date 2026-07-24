import { describe, expect, it } from "vitest";

import {
  townSurfaceThreadName,
  legacyTownSurfaceThreadName,
  matchesTownSurfaceThreadName,
  parseTownSurfaceKind,
  parseMarkableTownSurface,
} from "./town-surfaces.js";

describe("town surface thread names", () => {
  it("uses the surface label without short game id", () => {
    expect(townSurfaceThreadName("whisper-decl", "abcdef12-xxxx")).toBe("Whisper Declaration");
    expect(townSurfaceThreadName("claims", "abcdef12-xxxx")).toBe("Public Claims");
    expect(townSurfaceThreadName("rules", "abcdef12-xxxx")).toBe("Rules");
  });

  it("matches leftover Label · shortId threads from a prior game in the same channel", () => {
    const gameId = "bbd94f93-a5bc-4fdd-afd1-d3cde4cf5468";
    expect(matchesTownSurfaceThreadName("Whisper Declaration · 0eb92c", "whisper-decl", gameId)).toBe(
      true,
    );
    expect(matchesTownSurfaceThreadName("Public Claims · bbd94f", "claims", gameId)).toBe(true);
    expect(matchesTownSurfaceThreadName("Rules and References", "rules", gameId)).toBe(false);
    expect(legacyTownSurfaceThreadName("whisper-decl", gameId)).toBe("Whisper Declaration · bbd94f");
  });

  it("parses mark surface aliases", () => {
    expect(parseTownSurfaceKind("rules")).toBe("rules");
    expect(parseTownSurfaceKind("claims")).toBe("claims");
    expect(parseTownSurfaceKind("whisper")).toBe("whisper-decl");
    expect(parseTownSurfaceKind("whisper-declaration")).toBe("whisper-decl");
    expect(parseTownSurfaceKind("voting")).toBeNull();
    expect(parseTownSurfaceKind("nope")).toBeNull();
  });

  it("parses markable surfaces including Town Voting", () => {
    expect(parseMarkableTownSurface("voting")).toBe("voting");
    expect(parseMarkableTownSurface("vote")).toBe("voting");
    expect(parseMarkableTownSurface("town-voting")).toBe("voting");
    expect(parseMarkableTownSurface("rules")).toBe("rules");
    expect(parseMarkableTownSurface("whisper")).toBe("whisper-decl");
    expect(parseMarkableTownSurface("nope")).toBeNull();
  });
});

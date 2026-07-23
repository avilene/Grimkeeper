import { describe, expect, it } from "vitest";

import {
  townSurfaceThreadName,
  parseTownSurfaceKind,
  parseMarkableTownSurface,
} from "./town-surfaces.js";

describe("town surface thread names", () => {
  it("uses the surface label without short game id", () => {
    expect(townSurfaceThreadName("whisper-decl", "abcdef12-xxxx")).toBe("Whisper Declaration");
    expect(townSurfaceThreadName("claims", "abcdef12-xxxx")).toBe("Public Claims");
    expect(townSurfaceThreadName("rules", "abcdef12-xxxx")).toBe("Rules");
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

import { describe, expect, it } from "vitest";

import { townSurfaceThreadName, parseTownSurfaceKind } from "./town-surfaces.js";

describe("town surface thread names", () => {
  it("includes the surface label and short game id", () => {
    expect(townSurfaceThreadName("whisper-decl", "abcdef12-xxxx")).toBe(
      "Whisper Declaration · abcdef",
    );
    expect(townSurfaceThreadName("claims", "abcdef12-xxxx")).toBe("Public Claims · abcdef");
    expect(townSurfaceThreadName("rules", "abcdef12-xxxx")).toBe("Rules · abcdef");
  });

  it("parses mark surface aliases", () => {
    expect(parseTownSurfaceKind("rules")).toBe("rules");
    expect(parseTownSurfaceKind("claims")).toBe("claims");
    expect(parseTownSurfaceKind("whisper")).toBe("whisper-decl");
    expect(parseTownSurfaceKind("whisper-declaration")).toBe("whisper-decl");
    expect(parseTownSurfaceKind("nope")).toBeNull();
  });
});

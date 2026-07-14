import { afterEach, describe, expect, it } from "vitest";

import { resetSeenInteractionsForTests, tryMarkInteractionOnce } from "./interaction-dedup.js";

describe("tryMarkInteractionOnce", () => {
  afterEach(() => {
    resetSeenInteractionsForTests();
  });

  it("accepts the first sighting and rejects duplicates", () => {
    expect(tryMarkInteractionOnce("abc")).toBe(true);
    expect(tryMarkInteractionOnce("abc")).toBe(false);
    expect(tryMarkInteractionOnce("def")).toBe(true);
  });
});

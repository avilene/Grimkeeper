import { describe, expect, it } from "vitest";

import { defaultPlayerAlias } from "./alias.js";

describe("defaultPlayerAlias", () => {
  it("strips bracket and paren nickname tags", () => {
    expect(defaultPlayerAlias("sharii🦀 [craboots!]")).toBe("sharii🦀");
    expect(defaultPlayerAlias("Alice (she/her)")).toBe("Alice");
  });
});

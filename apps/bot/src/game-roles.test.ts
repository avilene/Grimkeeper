import { afterEach, describe, expect, it } from "vitest";

import { roleSlugFromChannelName } from "./commands/command-context.js";
import { MINIMAL_MIN_PLAYERS, minPlayersForMode } from "./bot-mode.js";

describe("roleSlugFromChannelName", () => {
  it("derives slug used for st, p, and spec role names", () => {
    const slug = roleSlugFromChannelName("Town Square #1");
    expect(slug).toBe("town-square-1");
    expect(`st-${slug}`).toBe("st-town-square-1");
    expect(`p-${slug}`).toBe("p-town-square-1");
    expect(`spec-${slug}`).toBe("spec-town-square-1");
  });

  it("falls back to game for empty slugs", () => {
    expect(roleSlugFromChannelName("!!!")).toBe("game");
  });
});

describe("minimal mode player gate", () => {
  const original = process.env.BOT_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = original;
    }
  });

  it("has no minimum player count in minimal mode", () => {
    process.env.BOT_MODE = "minimal";
    expect(MINIMAL_MIN_PLAYERS).toBe(0);
    expect(minPlayersForMode()).toBe(0);
  });
});

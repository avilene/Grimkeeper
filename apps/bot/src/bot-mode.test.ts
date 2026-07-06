import { afterEach, describe, expect, it } from "vitest";

import {
  MINIMAL_MIN_PLAYERS,
  isMinimalMode,
  minPlayersForMode,
} from "./bot-mode.js";

describe("isMinimalMode", () => {
  const original = process.env.BOT_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = original;
    }
  });

  it("returns true when BOT_MODE is minimal", () => {
    process.env.BOT_MODE = "minimal";
    expect(isMinimalMode()).toBe(true);
  });

  it("returns false when BOT_MODE is full or unset", () => {
    process.env.BOT_MODE = "full";
    expect(isMinimalMode()).toBe(false);
    delete process.env.BOT_MODE;
    expect(isMinimalMode()).toBe(false);
  });
});

describe("minPlayersForMode", () => {
  const originalBotMode = process.env.BOT_MODE;
  const originalDevMode = process.env.DEV_MODE;

  afterEach(() => {
    if (originalBotMode === undefined) {
      delete process.env.BOT_MODE;
    } else {
      process.env.BOT_MODE = originalBotMode;
    }
    if (originalDevMode === undefined) {
      delete process.env.DEV_MODE;
    } else {
      process.env.DEV_MODE = originalDevMode;
    }
  });

  it("returns 7 in minimal mode", () => {
    process.env.BOT_MODE = "minimal";
    expect(minPlayersForMode()).toBe(MINIMAL_MIN_PLAYERS);
    expect(MINIMAL_MIN_PLAYERS).toBe(7);
  });

  it("returns 5 in full mode without dev", () => {
    process.env.BOT_MODE = "full";
    process.env.DEV_MODE = "false";
    expect(minPlayersForMode()).toBe(5);
  });

  it("returns 3 in full dev mode", () => {
    process.env.BOT_MODE = "full";
    process.env.DEV_MODE = "true";
    expect(minPlayersForMode()).toBe(3);
  });
});

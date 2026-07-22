import { describe, expect, it } from "vitest";

import {
  normalizeDoActionInput,
  resolveDoActionName,
  ST_DO_ACTIONS,
} from "./action-catalog.js";

describe("normalizeDoActionInput", () => {
  it("strips autocomplete label after an em dash", () => {
    expect(
      normalizeDoActionInput("log — Create or reopen the ST-only audit log thread"),
    ).toBe("log");
  });

  it("keeps hyphenated action names", () => {
    expect(normalizeDoActionInput("mark-dead")).toBe("mark-dead");
    expect(normalizeDoActionInput("close-nominations — Close nominations")).toBe(
      "close-nominations",
    );
  });
});

describe("resolveDoActionName", () => {
  it("resolves pasted autocomplete labels to action names", () => {
    expect(
      resolveDoActionName(
        "log — Create or reopen the ST-only audit log thread",
        ST_DO_ACTIONS,
      ),
    ).toBe("log");
    expect(resolveDoActionName("LOG", ST_DO_ACTIONS)).toBe("log");
  });

  it("returns null for unknown actions", () => {
    expect(resolveDoActionName("nope — something", ST_DO_ACTIONS)).toBeNull();
  });
});

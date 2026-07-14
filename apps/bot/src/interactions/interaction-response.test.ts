import { describe, expect, it } from "vitest";

import { isInteractionAlreadyAcknowledged } from "./interaction-response.js";

describe("isInteractionAlreadyAcknowledged", () => {
  it("detects Discord already-acknowledged errors", () => {
    expect(isInteractionAlreadyAcknowledged({ code: 40060 })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isInteractionAlreadyAcknowledged({ code: 10062 })).toBe(false);
    expect(isInteractionAlreadyAcknowledged(new Error("nope"))).toBe(false);
  });
});

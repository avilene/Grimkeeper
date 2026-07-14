import { describe, expect, it } from "vitest";

import {
  isInteractionAlreadyAcknowledged,
  isRecoverableInteractionResponseError,
} from "./interaction-response.js";

describe("isRecoverableInteractionResponseError", () => {
  it("detects already-acknowledged API errors", () => {
    expect(isRecoverableInteractionResponseError({ code: 40060 })).toBe(true);
  });

  it("detects editReply without defer errors", () => {
    expect(isRecoverableInteractionResponseError({ code: "InteractionNotReplied" })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isRecoverableInteractionResponseError({ code: 10062 })).toBe(false);
    expect(isRecoverableInteractionResponseError(new Error("nope"))).toBe(false);
  });
});

describe("isInteractionAlreadyAcknowledged", () => {
  it("matches recoverable acknowledgement errors", () => {
    expect(isInteractionAlreadyAcknowledged({ code: 40060 })).toBe(true);
    expect(isInteractionAlreadyAcknowledged({ code: "InteractionNotReplied" })).toBe(true);
  });
});

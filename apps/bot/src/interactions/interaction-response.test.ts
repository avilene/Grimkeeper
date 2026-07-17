import { describe, expect, it, vi } from "vitest";

import {
  INTERACTION_PENDING_CONTENT,
  isBenignInteractionAckError,
  isInteractionAlreadyAcknowledged,
  isRecoverableInteractionResponseError,
  isUnknownInteractionError,
  toEditReplyPayload,
  withAcknowledgedFallback,
} from "./interaction-response.js";

describe("isRecoverableInteractionResponseError", () => {
  it("detects already-acknowledged API errors", () => {
    expect(isRecoverableInteractionResponseError({ code: 40060 })).toBe(true);
  });

  it("detects unknown/expired interaction errors", () => {
    expect(isRecoverableInteractionResponseError({ code: 10062 })).toBe(true);
    expect(isUnknownInteractionError({ code: 10062 })).toBe(true);
  });

  it("detects editReply without defer errors", () => {
    expect(isRecoverableInteractionResponseError({ code: "InteractionNotReplied" })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isRecoverableInteractionResponseError({ code: 50035 })).toBe(false);
    expect(isRecoverableInteractionResponseError(new Error("nope"))).toBe(false);
  });
});

describe("isInteractionAlreadyAcknowledged", () => {
  it("matches recoverable acknowledgement errors", () => {
    expect(isInteractionAlreadyAcknowledged({ code: 40060 })).toBe(true);
    expect(isInteractionAlreadyAcknowledged({ code: "InteractionNotReplied" })).toBe(true);
    expect(isBenignInteractionAckError({ code: 10062 })).toBe(true);
  });
});

describe("toEditReplyPayload", () => {
  it("clears pending content when final reply is embeds-only", () => {
    expect(toEditReplyPayload({ embeds: [{} as never] })).toEqual({
      embeds: [{}],
      content: null,
    });
  });

  it("preserves explicit content", () => {
    expect(toEditReplyPayload({ content: "done", embeds: [{} as never] })).toEqual({
      content: "done",
      embeds: [{}],
    });
  });
});

describe("INTERACTION_PENDING_CONTENT", () => {
  it("is a non-empty pending message", () => {
    expect(INTERACTION_PENDING_CONTENT.length).toBeGreaterThan(0);
  });
});

describe("withAcknowledgedFallback", () => {
  it("swallows recoverable errors when all attempts fail", async () => {
    const attempts = [
      vi.fn().mockRejectedValue({ code: "InteractionNotReplied" }),
      vi.fn().mockRejectedValue({ code: 40060 }),
    ];
    await expect(withAcknowledgedFallback(attempts)).resolves.toBeUndefined();
    expect(attempts[0]).toHaveBeenCalledOnce();
    expect(attempts[1]).toHaveBeenCalledOnce();
  });

  it("stops immediately on unknown interaction without further attempts", async () => {
    const attempts = [
      vi.fn().mockRejectedValue({ code: 10062 }),
      vi.fn().mockResolvedValue(undefined),
    ];
    await expect(withAcknowledgedFallback(attempts)).resolves.toBeUndefined();
    expect(attempts[0]).toHaveBeenCalledOnce();
    expect(attempts[1]).not.toHaveBeenCalled();
  });

  it("stops after the first successful attempt", async () => {
    const attempts = [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
    ];
    await withAcknowledgedFallback(attempts);
    expect(attempts[0]).toHaveBeenCalledOnce();
    expect(attempts[1]).not.toHaveBeenCalled();
  });
});

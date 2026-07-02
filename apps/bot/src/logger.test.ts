import { describe, expect, it } from "vitest";

import { enrichMultilineText, serializeError } from "./logger.js";

describe("serializeError", () => {
  it("captures stack lines for Error objects", () => {
    const error = new Error("boom");
    const fields = serializeError(error);
    expect(fields.error).toBe("boom");
    expect(fields.errorName).toBe("Error");
    expect(Array.isArray(fields.stackLines)).toBe(true);
    expect((fields.stackLines as string[])[0]).toContain("Error: boom");
  });

  it("splits multiline strings into detail lines", () => {
    const fields = enrichMultilineText("first line\nsecond line\nthird line");
    expect(fields.message).toBe("first line");
    expect(fields.detailLines).toEqual(["second line", "third line"]);
  });
});

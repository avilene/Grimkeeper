import { afterEach, describe, expect, it } from "vitest";

import { canUseMinimalVoting } from "./access.js";

describe("canUseMinimalVoting", () => {
  const original = process.env.ALLOWED_USER_IDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOWED_USER_IDS;
    } else {
      process.env.ALLOWED_USER_IDS = original;
    }
  });

  it("blocks everyone when ALLOWED_USER_IDS is empty", () => {
    delete process.env.ALLOWED_USER_IDS;
    expect(canUseMinimalVoting("123")).toBe(false);
  });

  it("allows only listed user ids", () => {
    process.env.ALLOWED_USER_IDS = "111, 222";
    expect(canUseMinimalVoting("111")).toBe(true);
    expect(canUseMinimalVoting("222")).toBe(true);
    expect(canUseMinimalVoting("333")).toBe(false);
    expect(canUseMinimalVoting(undefined)).toBe(false);
  });
});

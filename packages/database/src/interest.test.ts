import { describe, expect, it } from "vitest";

import { isInterestSignupState, nextInterestSignupState } from "./interest.js";

describe("nextInterestSignupState", () => {
  it("adds when nowhere", () => {
    expect(nextInterestSignupState(null, "playing")).toBe("playing");
    expect(nextInterestSignupState(null, "kib")).toBe("kib");
    expect(nextInterestSignupState(null, "backup")).toBe("backup");
  });

  it("removes when clicking the same state", () => {
    expect(nextInterestSignupState("playing", "playing")).toBeNull();
    expect(nextInterestSignupState("kib", "kib")).toBeNull();
    expect(nextInterestSignupState("backup", "backup")).toBeNull();
  });

  it("moves between states", () => {
    expect(nextInterestSignupState("kib", "playing")).toBe("playing");
    expect(nextInterestSignupState("playing", "backup")).toBe("backup");
    expect(nextInterestSignupState("backup", "kib")).toBe("kib");
  });
});

describe("isInterestSignupState", () => {
  it("accepts known states", () => {
    expect(isInterestSignupState("playing")).toBe(true);
    expect(isInterestSignupState("kib")).toBe(true);
    expect(isInterestSignupState("backup")).toBe(true);
  });

  it("rejects unknown", () => {
    expect(isInterestSignupState("none")).toBe(false);
    expect(isInterestSignupState("")).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { getDeployRelease, getDeployReleaseShort } from "./deploy-release.js";

describe("getDeployRelease", () => {
  const original = process.env.SENTRY_RELEASE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SENTRY_RELEASE;
    } else {
      process.env.SENTRY_RELEASE = original;
    }
  });

  it("returns trimmed SENTRY_RELEASE", () => {
    process.env.SENTRY_RELEASE = "  abcdef1234567890  ";
    expect(getDeployRelease()).toBe("abcdef1234567890");
  });

  it("returns undefined when unset", () => {
    delete process.env.SENTRY_RELEASE;
    expect(getDeployRelease()).toBeUndefined();
  });
});

describe("getDeployReleaseShort", () => {
  const original = process.env.SENTRY_RELEASE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SENTRY_RELEASE;
    } else {
      process.env.SENTRY_RELEASE = original;
    }
  });

  it("returns first 7 chars of the full sha", () => {
    process.env.SENTRY_RELEASE = "abcdef1234567890";
    expect(getDeployReleaseShort()).toBe("abcdef1");
  });

  it("returns short values unchanged", () => {
    process.env.SENTRY_RELEASE = "dev";
    expect(getDeployReleaseShort()).toBe("dev");
  });
});

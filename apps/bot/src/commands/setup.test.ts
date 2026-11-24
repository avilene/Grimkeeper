import { describe, expect, it } from "vitest";

import {
  describeAllowedRolesSource,
  describeConfiguredRoleCount,
} from "./setup.js";

describe("setup helpers", () => {
  it("treats null allowedRoleIds as env fallback", () => {
    expect(describeAllowedRolesSource({ allowedRoleIds: null })).toBe("env");
    expect(describeAllowedRolesSource({ allowedRoleIds: "" })).toBe("db");
    expect(describeAllowedRolesSource({ allowedRoleIds: "r1" })).toBe("db");
  });

  it("counts configured roles in CSV", () => {
    expect(describeConfiguredRoleCount(null)).toBe(0);
    expect(describeConfiguredRoleCount("")).toBe(0);
    expect(describeConfiguredRoleCount("a,b")).toBe(2);
  });
});

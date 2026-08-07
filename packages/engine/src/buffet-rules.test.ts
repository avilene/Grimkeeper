import { describe, expect, it } from "vitest";
import { defaultBuffetConfig } from "./buffet-draft.js";
import {
  describeBuffetRules,
  formatBuffetRulesMessage,
} from "./buffet-rules.js";

describe("describeBuffetRules", () => {
  it("lists enabled roles and buffet house rules", () => {
    const config = {
      ...defaultBuffetConfig(),
      enabledRoleIds: ["washerwoman", "butler", "imp", "poisoner", "baron", "lunatic", "drunk"],
      mulliganSteps: [3, 2, 1],
      recycleUnchosen: true,
    };
    const rules = describeBuffetRules(config);
    expect(rules.roleSummary).toMatch(/Washerwoman/i);
    expect(rules.roleSummary).toMatch(/Imp/i);
    expect(rules.rules.some((r) => /Mulligans/i.test(r))).toBe(true);
    expect(rules.rules.some((r) => /Baron/i.test(r))).toBe(true);
    expect(rules.rules.some((r) => /Lunatic/i.test(r))).toBe(true);
    expect(rules.rules.some((r) => /Drunk/i.test(r))).toBe(true);
  });

  it("formats a discord message", () => {
    const text = formatBuffetRulesMessage(defaultBuffetConfig());
    expect(text).toMatch(/Sushi Buffet script/i);
    expect(text).toContain("**How this draft works**");
  });
});

import { describe, expect, it } from "vitest";
import { parseScriptJson, resolveStandardScript } from "./parse.js";
import { StandardEdition } from "./types.js";

describe("parseScriptJson", () => {
  it("parses official id-only scripts", () => {
    const script = parseScriptJson(["_meta", { id: "_meta", name: "Tiny TB" }, "washerwoman", "librarian", "investigator", "imp", "poisoner"]);
    expect(script.name).toBe("Tiny TB");
    expect(script.roles).toHaveLength(5);
    expect(script.roles[0]?.id).toBe("washerwoman");
  });

  it("resolves standard editions", () => {
    const tb = resolveStandardScript(StandardEdition.TB);
    const bmr = resolveStandardScript(StandardEdition.BMR);
    const snv = resolveStandardScript(StandardEdition.SNV);
    expect(tb.roles.length).toBeGreaterThan(20);
    expect(bmr.name).toBe("Bad Moon Rising");
    expect(snv.name).toBe("Sects & Violets");
  });
});

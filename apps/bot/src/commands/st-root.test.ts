import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ST_ROOT_ACTIONS } from "./action-catalog.js";

describe("StRootCommands", () => {
  it("registers a top-level @Slash for every flattened ST action", () => {
    const source = readFileSync(new URL("./st-root.ts", import.meta.url), "utf8");
    for (const action of ST_ROOT_ACTIONS) {
      expect(source, `missing @Slash for /${action.name}`).toContain(`name: "${action.name}"`);
    }
  });
});

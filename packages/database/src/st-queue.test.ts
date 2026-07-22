import { describe, expect, it } from "vitest";

import { parseScriptImageUrls, serializeScriptImageUrls } from "./st-queue.js";

describe("script image url helpers", () => {
  it("round-trips urls and dedupes", () => {
    const raw = serializeScriptImageUrls([
      "https://a.example/1.png",
      " https://a.example/1.png ",
      "https://b.example/2.png",
      "",
    ]);
    expect(parseScriptImageUrls(raw)).toEqual([
      "https://a.example/1.png",
      "https://b.example/2.png",
    ]);
  });

  it("returns empty on invalid json", () => {
    expect(parseScriptImageUrls("not-json")).toEqual([]);
  });
});

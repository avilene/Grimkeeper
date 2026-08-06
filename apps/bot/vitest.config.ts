import { defineConfig } from "vitest/config";
import { ciReporters } from "../../scripts/vitest-ci-reporters.ts";

export default defineConfig({
  test: {
    name: "bot",
    include: ["src/**/*.test.ts"],
    reporters: ciReporters("bot"),
  },
});

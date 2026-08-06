import { defineConfig } from "vitest/config";
import { ciReporters } from "../../scripts/vitest-ci-reporters.ts";

export default defineConfig({
  test: {
    name: "database",
    include: ["src/**/*.test.ts"],
    ...(ciReporters("database") ? { reporters: ciReporters("database") } : {}),
  },
});

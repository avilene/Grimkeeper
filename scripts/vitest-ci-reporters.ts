import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Reporter } from "vitest/reporters";

const MARKER = "## Vitest Test Report";

/** Renames the last Vitest job-summary header so monorepo packages are distinguishable. */
function renameVitestSummary(name: string): Reporter {
  return {
    onTestRunEnd() {
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (!summaryPath || !existsSync(summaryPath)) {
        return;
      }
      const content = readFileSync(summaryPath, "utf8");
      const idx = content.lastIndexOf(MARKER);
      if (idx === -1) {
        return;
      }
      writeFileSync(
        summaryPath,
        `${content.slice(0, idx)}## ${name}${content.slice(idx + MARKER.length)}`,
      );
    },
  };
}

/** Default reporters locally; named GitHub Actions summaries in CI. */
export function ciReporters(name: string): Array<string | [string, object] | Reporter> | undefined {
  if (!process.env.GITHUB_ACTIONS) {
    return undefined;
  }
  return ["default", "github-actions", renameVitestSummary(name)];
}

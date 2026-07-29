/**
 * Sentry must load before other app modules (ESM: `node --import ./dist/instrument.js`).
 * Safe no-op when SENTRY_DSN is unset.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import * as Sentry from "@sentry/node";

import { getDeployRelease, getDeployReleaseShort } from "./deploy-release.js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

const dsn = process.env.SENTRY_DSN?.trim();
const deployRelease = getDeployRelease();
if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
    release: deployRelease,
    // 100% in non-production, lower in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    includeLocalVariables: true,
    debug: process.env.SENTRY_DEBUG === "1",
    // reportError owns process-level capture so Discord + Sentry stay on one path.
    integrations: (integrations) =>
      integrations.filter(
        (integration) =>
          integration.name !== "OnUncaughtException" &&
          integration.name !== "OnUnhandledRejection",
      ),
  });
  if (deployRelease) {
    Sentry.setTag("git.commit", deployRelease);
    const short = getDeployReleaseShort();
    if (short) Sentry.setTag("git.commit_short", short);
    Sentry.setContext("deploy", {
      commit: deployRelease,
      commitShort: short ?? deployRelease,
      trigger: process.env.DEPLOY_TRIGGER?.trim() || undefined,
      image: process.env.GRIMKEEPER_IMAGE?.trim() || undefined,
    });
  }
  // Logger is not loaded yet — console is intentional for boot confirmation.
  console.info(
    JSON.stringify({
      level: "info",
      msg: "sentry.init.ok",
      environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
      release: deployRelease ?? null,
    }),
  );
} else {
  console.info(
    JSON.stringify({
      level: "info",
      msg: "sentry.init.skipped",
      reason: "SENTRY_DSN unset",
      nodeEnv: process.env.NODE_ENV || null,
    }),
  );
}

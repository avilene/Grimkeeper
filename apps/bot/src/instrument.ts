/**
 * Sentry must load before other app modules (ESM: `node --import ./dist/instrument.js`).
 * Safe no-op when SENTRY_DSN is unset.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import * as Sentry from "@sentry/node";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE?.trim() || undefined,
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
  // Logger is not loaded yet — console is intentional for boot confirmation.
  console.info(
    JSON.stringify({
      level: "info",
      msg: "sentry.init.ok",
      environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
      release: process.env.SENTRY_RELEASE?.trim() || null,
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

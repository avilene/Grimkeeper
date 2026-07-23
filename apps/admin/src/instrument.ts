/**
 * Sentry must load before other app modules (ESM: `node --import ./dist/instrument.js`).
 * Safe no-op when SENTRY_DSN is unset.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import * as Sentry from "@sentry/node";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");
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
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    includeLocalVariables: true,
  });
}

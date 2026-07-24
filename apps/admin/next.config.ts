import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { withSentryConfig } from "@sentry/nextjs";

const adminDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(adminDir, "../..");

loadEnv({ path: path.join(monorepoRoot, ".env") });

/** Resolve relative SQLite file: URLs against the monorepo root (same as the old Express admin). */
function resolveDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL ?? "file:./packages/database/prisma/dev.db";
  if (!raw.startsWith("file:")) return;
  const pathPart = raw.slice("file:".length);
  if (pathPart.startsWith("/") || pathPart.startsWith(":memory:")) return;
  process.env.DATABASE_URL = `file:${path.resolve(monorepoRoot, pathPart)}`;
}

resolveDatabaseUrl();

if (!process.env.AUTH_URL) {
  const callback = process.env.ADMIN_OAUTH_CALLBACK_URL?.trim();
  if (callback) {
    try {
      process.env.AUTH_URL = new URL(callback).origin;
    } catch {
      /* ignore */
    }
  }
}

/** Expose admin DSN to the browser bundle when only ADMIN_SENTRY_DSN is set (Docker/.env). */
if (!process.env.NEXT_PUBLIC_ADMIN_SENTRY_DSN && process.env.ADMIN_SENTRY_DSN) {
  process.env.NEXT_PUBLIC_ADMIN_SENTRY_DSN = process.env.ADMIN_SENTRY_DSN;
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@grimkeeper/database", "@grimkeeper/engine"],
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/adapter-better-sqlite3"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG?.trim() || "grimkeeper",
  project: process.env.SENTRY_PROJECT_ADMIN?.trim() || "admin",
  // Source maps upload only when an auth token is present (CI / local release builds).
  authToken: process.env.SENTRY_AUTH_TOKEN?.trim(),
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/sentry-tunnel",
  disableLogger: true,
});

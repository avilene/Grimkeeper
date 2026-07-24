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
  // Keep engine transpile for workspace resolution; database must stay external so
  // better-sqlite3's native .node binary is required from node_modules (not bundled).
  transpilePackages: ["@grimkeeper/engine"],
  serverExternalPackages: [
    "@grimkeeper/database",
    "better-sqlite3",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
  ],
  outputFileTracingIncludes: {
    "/**": [
      "../../node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/**/*",
      "../../packages/database/dist/**/*",
      "../../packages/database/package.json",
      "../../packages/database/node_modules/better-sqlite3/**/*",
    ],
  },
  // Sentry / monorepo tracing can still inline native deps into server chunks; when that
  // happens bindings() looks under apps/admin/.next instead of node_modules.
  webpack: (config, { isServer }) => {
    if (!isServer) return config;

    const externalPkgs = ["better-sqlite3", "@prisma/adapter-better-sqlite3"];
    const externalize = (
      { request }: { request?: string },
      callback: (error?: Error | null, result?: string) => void,
    ) => {
      if (
        request &&
        externalPkgs.some((pkg) => request === pkg || request.startsWith(`${pkg}/`))
      ) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    };

    if (Array.isArray(config.externals)) {
      config.externals.push(externalize);
    } else if (config.externals) {
      config.externals = [config.externals, externalize];
    } else {
      config.externals = [externalize];
    }

    return config;
  },
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

import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

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

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@grimkeeper/database", "@grimkeeper/engine"],
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;

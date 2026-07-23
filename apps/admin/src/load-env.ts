import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

/** Resolve SQLite file: URLs relative to the monorepo root (same as the bot). */
function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:./packages/database/prisma/dev.db";
  if (!raw.startsWith("file:")) return raw;
  const pathPart = raw.slice("file:".length);
  if (pathPart.startsWith("/") || pathPart.startsWith(":memory:")) return raw;
  return `file:${resolve(repoRoot, pathPart)}`;
}

process.env.DATABASE_URL = resolveDatabaseUrl();

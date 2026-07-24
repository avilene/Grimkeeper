import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prismaLogLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === "development"
    ? ["warn", "error", "info", "query"]
    : ["warn", "error"];

/**
 * Prefer an explicit native binding path so Next standalone cannot lose the .node file.
 * Next may rewrite `import.meta.url` to the build-machine path, so also probe cwd layouts
 * used by the admin Docker image / monorepo.
 */
function resolveBetterSqlite3Binding(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("better-sqlite3/build/Release/better_sqlite3.node");
  } catch {
    /* fall through */
  }

  const candidates = [
    path.join(
      process.cwd(),
      "packages/database/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ),
    path.join(process.cwd(), "node_modules/better-sqlite3/build/Release/better_sqlite3.node"),
    path.join(
      process.cwd(),
      "apps/admin/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ),
    // Last resort when better-sqlite3 was inlined into a Next server chunk.
    path.join(process.cwd(), "apps/admin/.next/build/Release/better_sqlite3.node"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./packages/database/prisma/dev.db";
  const nativeBinding = resolveBetterSqlite3Binding();
  const adapter = new PrismaBetterSqlite3(
    nativeBinding ? { url, nativeBinding } : { url },
  );

  return new PrismaClient({
    adapter,
    log: prismaLogLevels.map((level) => ({ emit: "event", level })),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export type { Prisma };

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prismaLogLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === "development"
    ? ["warn", "error", "info", "query"]
    : ["warn", "error"];

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./packages/database/prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url });

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

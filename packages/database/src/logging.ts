import type { Prisma, PrismaClient } from "@prisma/client";

export type DbLogLevel = "debug" | "info" | "warn" | "error";

export type DbLogFn = (level: DbLogLevel, msg: string, fields: Record<string, unknown>) => void;

type InstrumentedPrisma = PrismaClient<
  Prisma.PrismaClientOptions,
  "warn" | "error" | "info" | "query"
>;

export function bindPrismaLogging(prisma: PrismaClient, log: DbLogFn): void {
  const client = prisma as InstrumentedPrisma;

  client.$on("warn", (event: Prisma.LogEvent) => {
    log("warn", "prisma", { target: event.target, message: event.message });
  });
  client.$on("error", (event: Prisma.LogEvent) => {
    log("error", "prisma", { target: event.target, message: event.message });
  });
  client.$on("info", (event: Prisma.LogEvent) => {
    log("info", "prisma", { target: event.target, message: event.message });
  });
  client.$on("query", (event: Prisma.QueryEvent) => {
    log("debug", "prisma.query", {
      target: event.target,
      query: event.query,
      durationMs: event.duration,
    });
  });
}

import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

export type DbLogLevel = "debug" | "info" | "warn" | "error";

export type DbLogFn = (level: DbLogLevel, msg: string, fields: Record<string, unknown>) => void;

interface PrismaEventClient {
  $on(event: "warn", callback: (event: Prisma.LogEvent) => void): void;
  $on(event: "error", callback: (event: Prisma.LogEvent) => void): void;
  $on(event: "info", callback: (event: Prisma.LogEvent) => void): void;
  $on(event: "query", callback: (event: Prisma.QueryEvent) => void): void;
}

export function bindPrismaLogging(client: PrismaClient, log: DbLogFn): void {
  const events = client as unknown as PrismaEventClient;

  events.$on("warn", (event) => {
    log("warn", "prisma", { target: event.target, message: event.message });
  });
  events.$on("error", (event) => {
    log("error", "prisma", { target: event.target, message: event.message });
  });
  events.$on("info", (event) => {
    log("info", "prisma", { target: event.target, message: event.message });
  });
  events.$on("query", (event) => {
    log("debug", "prisma.query", {
      target: event.target,
      query: event.query,
      durationMs: event.duration,
    });
  });
}

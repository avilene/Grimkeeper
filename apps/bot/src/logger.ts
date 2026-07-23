import { format } from "node:util";

import pino, { type Logger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const fields: Record<string, unknown> = {
      error: error.message,
      errorName: error.name,
    };
    if (error.stack) {
      fields.stack = error.stack;
      fields.stackLines = error.stack.split("\n");
    }
    if (error.cause !== undefined) {
      fields.cause = serializeError(error.cause);
    }
    return fields;
  }

  if (typeof error === "string") {
    return enrichMultilineText(error);
  }

  return { error: String(error) };
}

export function enrichMultilineText(text: string): Record<string, unknown> {
  if (!text.includes("\n")) {
    return { message: text };
  }

  const lines = text.split("\n");
  return {
    message: lines[0] ?? text,
    detailLines: lines.slice(1),
  };
}

function isStructuredLogLine(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "level" in parsed &&
      "msg" in parsed &&
      typeof (parsed as { level: unknown }).level === "string" &&
      typeof (parsed as { msg: unknown }).msg === "string"
    );
  } catch {
    return false;
  }
}

function createLogger(): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
      messageKey: "msg",
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: {
        paths: ["token", "discordToken", "password", "apiKey", "DATABASE_URL"],
        censor: "[REDACTED]",
      },
    },
    pino.destination(1),
  );
}

export const logger = createLogger();

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  logger[level](fields, msg);
}

export function logError(
  level: LogLevel,
  msg: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): void {
  const merged = { ...fields, ...serializeError(error) };
  logger[level](merged, msg);
}

let logCaptureInstalled = false;

export function installLogCapture(): void {
  if (logCaptureInstalled) return;
  logCaptureInstalled = true;

  const wrap =
    (stream: "log" | "warn" | "error", level: LogLevel) =>
    (...args: unknown[]): void => {
      const formatted = formatConsoleArgs(args);
      if (formatted.structuredLine) {
        const destination = level === "error" ? process.stderr : process.stdout;
        destination.write(`${formatted.structuredLine}\n`);
        return;
      }

      if (formatted.error instanceof Error) {
        const merged = { stream, ...formatted.fields, ...serializeError(formatted.error) };
        logger[level](merged, "external");
        return;
      }

      logger[level]({ stream, ...formatted.fields }, "external");
    };

  console.log = wrap("log", "info");
  console.warn = wrap("warn", "warn");
  console.error = wrap("error", "error");

  process.on("warning", (warning) => {
    log("warn", "node.warning", {
      name: warning.name,
      message: warning.message,
      ...(warning.stack ? { stack: warning.stack, stackLines: warning.stack.split("\n") } : {}),
    });
  });
}

function formatConsoleArgs(args: unknown[]): {
  structuredLine: string | null;
  fields: Record<string, unknown>;
  error?: Error;
} {
  if (args.length === 0) {
    return { structuredLine: null, fields: { message: "" } };
  }

  if (args.length === 1 && typeof args[0] === "string" && isStructuredLogLine(args[0])) {
    return { structuredLine: args[0], fields: {} };
  }

  const errors = args.filter((arg): arg is Error => arg instanceof Error);
  const otherArgs = args.filter((arg) => !(arg instanceof Error));
  const text = otherArgs.length > 0 ? format(...otherArgs) : "";

  const fields: Record<string, unknown> = {};
  if (text) {
    Object.assign(fields, enrichMultilineText(text));
  }

  let error: Error | undefined;
  if (errors.length === 1) {
    error = errors[0];
  } else if (errors.length > 1) {
    fields.errors = errors.map((item) => serializeError(item));
  }

  if (!fields.message && typeof fields.error === "string") {
    fields.message = fields.error;
  }

  return { structuredLine: null, fields, error };
}

import { format } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

function writeLine(level: LogLevel, line: string): void {
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
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

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  writeLine(
    level,
    JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

let logCaptureInstalled = false;

export function installLogCapture(): void {
  if (logCaptureInstalled) return;
  logCaptureInstalled = true;

  const wrap =
    (stream: "log" | "warn" | "error", level: LogLevel) =>
    (...args: unknown[]): void => {
      const message = formatArgs(args);
      if (message && isStructuredLogLine(message)) {
        writeLine(level, message);
        return;
      }
      log(level, "external", { stream, message });
    };

  console.log = wrap("log", "info");
  console.warn = wrap("warn", "warn");
  console.error = wrap("error", "error");

  process.on("warning", (warning) => {
    log("warn", "node.warning", {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  return format(...args);
}

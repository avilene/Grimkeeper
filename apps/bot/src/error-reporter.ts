import type { Client, TextChannel } from "discord.js";

import { getBotClient } from "./discord-client.js";
import { log, logError, serializeError } from "./logger.js";

const DISCORD_MESSAGE_LIMIT = 2000;
const DEDUPE_WINDOW_MS = 60_000;
const MIN_SEND_INTERVAL_MS = 1_500;
const MAX_QUEUE_SIZE = 50;

type PendingReport = {
  source: string;
  error: unknown;
  context: Record<string, unknown>;
};

const pendingReports: PendingReport[] = [];
const recentFingerprints = new Map<string, number>();
let lastSentAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let processHandlersInstalled = false;

export function getErrorChannelId(): string | null {
  const value = process.env.ERROR_CHANNEL_ID?.trim();
  return value ? value : null;
}

export function formatErrorForDiscord(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  const serialized = serializeError(error);
  const lines = [`**[${source}]**`];

  const message =
    (typeof serialized.error === "string" && serialized.error) ||
    (typeof serialized.message === "string" && serialized.message) ||
    String(error);
  lines.push(message);

  if (typeof serialized.errorName === "string") {
    lines.push(`Type: \`${serialized.errorName}\``);
  }

  const contextEntries = Object.entries(context).filter(([, value]) => value !== undefined);
  if (contextEntries.length > 0) {
    lines.push(
      contextEntries.map(([key, value]) => `${key}: ${formatContextValue(value)}`).join("\n"),
    );
  }

  if (typeof serialized.stack === "string") {
    lines.push("```", serialized.stack, "```");
  }

  let text = lines.join("\n");
  if (text.length > DISCORD_MESSAGE_LIMIT) {
    text = `${text.slice(0, DISCORD_MESSAGE_LIMIT - 20)}\n… (truncated)`;
  }
  return text;
}

function formatContextValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fingerprint(source: string, error: unknown): string {
  const serialized = serializeError(error);
  const message = typeof serialized.error === "string" ? serialized.error : String(error);
  const stackLine =
    typeof serialized.stack === "string" ? serialized.stack.split("\n")[1]?.trim() ?? "" : "";
  return `${source}:${message}:${stackLine}`;
}

function shouldSkipDuplicate(source: string, error: unknown): boolean {
  const key = fingerprint(source, error);
  const now = Date.now();
  const lastSeen = recentFingerprints.get(key);
  recentFingerprints.set(key, now);

  for (const [seenKey, seenAt] of recentFingerprints) {
    if (now - seenAt > DEDUPE_WINDOW_MS) {
      recentFingerprints.delete(seenKey);
    }
  }

  return lastSeen !== undefined && now - lastSeen < DEDUPE_WINDOW_MS;
}

function queueDiscordReport(report: PendingReport): void {
  if (!getErrorChannelId()) return;
  if (shouldSkipDuplicate(report.source, report.error)) return;

  if (pendingReports.length >= MAX_QUEUE_SIZE) {
    pendingReports.shift();
  }
  pendingReports.push(report);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDiscordReports();
  }, MIN_SEND_INTERVAL_MS);
}

async function sendToErrorChannel(client: Client, content: string): Promise<void> {
  const channelId = getErrorChannelId();
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    logError("warn", "errorReporter.channel.unavailable", new Error("ERROR_CHANNEL_ID is not a text channel"), {
      channelId,
    });
    return;
  }

  await (channel as TextChannel).send({ content }).catch((sendError: unknown) => {
    logError("warn", "errorReporter.channel.sendFailed", sendError, { channelId });
  });
}

export async function flushDiscordReports(client?: Client | null): Promise<void> {
  const resolvedClient = client ?? getBotClient();
  if (!resolvedClient?.isReady() || pendingReports.length === 0) {
    if (pendingReports.length > 0) {
      scheduleFlush();
    }
    return;
  }

  const now = Date.now();
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
    scheduleFlush();
    return;
  }

  const report = pendingReports.shift();
  if (!report) return;

  lastSentAt = now;
  const content = formatErrorForDiscord(report.source, report.error, report.context);
  await sendToErrorChannel(resolvedClient, content);

  if (pendingReports.length > 0) {
    scheduleFlush();
  }
}

export async function reportError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  logError("error", source, error, context);
  queueDiscordReport({ source, error, context });
  await flushDiscordReports();
}

export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on("uncaughtException", (error) => {
    void reportError("process.uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    void reportError("process.unhandledRejection", reason);
  });
}

export function registerClientErrorHandlers(client: Client): void {
  client.on("error", (error) => {
    void reportError("discord.client", error);
  });

  client.on("shardError", (error, shardId) => {
    void reportError("discord.shard", error, { shardId });
  });

  client.on("warn", (message) => {
    log("warn", "discord.warn", { message });
  });
}
